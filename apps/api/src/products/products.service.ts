import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService } from '../../../../libs/cache/src';
import { PrismaService } from '../../../../libs/db/src';

export interface ProductQuery {
  brand?: string;
  device?: string;
  sort?: 'relevance' | 'price_asc' | 'price_desc';
  page?: number;
  pageSize?: number;
}

export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  brand: string | null;
  priceCents: number;
  currency: string;
  availableQty: number;
  inStock: boolean;
}

type ProductQueryCacheEntry = string[];

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  async listProducts(query: ProductQuery) {
    const normalized = this.normalizeQuery(query);
    const catalogVersion = await this.getCatalogVersion();
    const queryKey = this.buildProductsQueryCacheKey(catalogVersion, normalized);
    const cachedIds = await this.cache.getJson<ProductQueryCacheEntry>(queryKey).catch(() => null);

    if (cachedIds) {
      const items = await this.hydrateProducts(catalogVersion, cachedIds);

      return {
        items,
        meta: {
          ...normalized,
          catalogVersion,
          cache: 'hit'
        }
      };
    }

    const lockKey = `lock:${queryKey}`;
    const hasLock = await this.cache.acquireLock(lockKey, 5).catch(() => false);

    try {
      const items = await this.fetchProducts(normalized);

      if (hasLock) {
        await Promise.all([
          this.cache.setJson(
            queryKey,
            items.map((item) => item.id),
            90
          ).catch(() => undefined),
          ...items.map((item) => this.cacheProductCard(catalogVersion, item))
        ]);
      }

      return {
        items,
        meta: {
          ...normalized,
          catalogVersion,
          cache: hasLock ? 'miss-populated' : 'miss-fallback'
        }
      };
    } finally {
      if (hasLock) {
        await this.cache.releaseLock(lockKey).catch(() => undefined);
      }
    }
  }

  async getProductById(id: string) {
    const catalogVersion = await this.getCatalogVersion();
    const cacheKey = `product:card:v${catalogVersion}:${id}`;
    const cached = await this.cache.getJson<ProductListItem>(cacheKey).catch(() => null);

    if (cached) {
      return cached;
    }

    const [product] = await this.fetchProducts({
      brand: '',
      device: '',
      page: 1,
      pageSize: 1,
      sort: 'relevance'
    }, { id });

    if (!product) {
      return null;
    }

    await this.cacheProductCard(catalogVersion, product);

    return product;
  }

  async invalidateAvailability(productIds: string[]) {
    const catalogVersion = await this.getCatalogVersion();

    await Promise.all(
      productIds.flatMap((productId) => [
        this.cache.delete(`product:availability:${productId}`).catch(() => undefined),
        this.cache.delete(`product:card:v${catalogVersion}:${productId}`).catch(() => undefined)
      ])
    );
  }

  buildProductsQueryCacheKey(
    catalogVersion: number,
    query: Required<ProductQuery>
  ) {
    return [
      `products:query:v${catalogVersion}`,
      `brand=${query.brand || 'all'}`,
      `device=${query.device || 'all'}`,
      `sort=${query.sort}`,
      `page=${query.page}`,
      `size=${query.pageSize}`
    ].join(':');
  }

  private normalizeQuery(query: ProductQuery): Required<ProductQuery> {
    return {
      brand: query.brand?.trim().toLowerCase() || '',
      device: query.device?.trim().toLowerCase() || '',
      sort: query.sort ?? 'relevance',
      page: query.page && query.page > 0 ? query.page : 1,
      pageSize: query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 50) : 24
    };
  }

  private async getCatalogVersion() {
    const version = await this.prisma.catalogVersion.findUnique({
      where: { key: 'catalog' }
    });

    return version?.version ?? 1;
  }

  private async fetchProducts(
    query: Required<ProductQuery>,
    extraWhere: Prisma.ProductWhereInput = {}
  ): Promise<ProductListItem[]> {
    const orderBy = this.buildOrderBy(query.sort);
    const where: Prisma.ProductWhereInput = {
      active: true,
      ...extraWhere,
      ...(query.brand ? { brand: { equals: query.brand, mode: 'insensitive' } } : {}),
      ...(query.device
        ? {
            compatibilities: {
              some: {
                deviceModel: {
                  slug: query.device
                }
              }
            }
          }
        : {})
    };

    const products = await this.prisma.product.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        price: true,
        inventory: true
      }
    });

    return products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      imageUrl: product.imageUrl,
      brand: product.brand,
      priceCents: product.price?.priceCents ?? 0,
      currency: product.price?.currency ?? 'BRL',
      availableQty: product.inventory?.availableQty ?? 0,
      inStock: (product.inventory?.availableQty ?? 0) > 0
    }));
  }

  private async hydrateProducts(catalogVersion: number, ids: string[]) {
    if (ids.length === 0) {
      return [];
    }

    const cacheKeys = ids.map((id) => `product:card:v${catalogVersion}:${id}`);
    const cachedProducts = await this.cache
      .getJsonMany<ProductListItem>(cacheKeys)
      .catch(() => ids.map(() => null));
    const productsById = new Map<string, ProductListItem>();
    const missingIds: string[] = [];

    ids.forEach((id, index) => {
      const cachedProduct = cachedProducts[index];

      if (cachedProduct) {
        productsById.set(id, cachedProduct);
      } else {
        missingIds.push(id);
      }
    });

    if (missingIds.length > 0) {
      const fetchedProducts = await this.fetchProducts(
        {
          brand: '',
          device: '',
          page: 1,
          pageSize: missingIds.length,
          sort: 'relevance'
        },
        { id: { in: missingIds } }
      );

      await Promise.all(
        fetchedProducts.map((product) => {
          productsById.set(product.id, product);

          return this.cacheProductCard(catalogVersion, product);
        })
      );
    }

    return ids
      .map((id) => productsById.get(id) ?? null)
      .filter((product): product is ProductListItem => product !== null);
  }

  private async cacheProductCard(catalogVersion: number, product: ProductListItem) {
    await this.cache
      .setJson(`product:card:v${catalogVersion}:${product.id}`, product, 300)
      .catch(() => undefined);
  }

  private buildOrderBy(sort: Required<ProductQuery>['sort']): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case 'price_asc':
        return [{ price: { priceCents: 'asc' } }, { id: 'asc' }];
      case 'price_desc':
        return [{ price: { priceCents: 'desc' } }, { id: 'asc' }];
      case 'relevance':
      default:
        return [
          { stats: { popularityScore: 'desc' } },
          { updatedAt: 'desc' },
          { id: 'asc' }
        ];
    }
  }
}
