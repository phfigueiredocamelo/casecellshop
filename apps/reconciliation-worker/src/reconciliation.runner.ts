import { Injectable } from '@nestjs/common';
import { CacheService } from '../../../libs/cache/src';
import { PrismaService } from '../../../libs/db/src';
import { ErpCatalogClient } from './erp-catalog.client';

@Injectable()
export class ReconciliationRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erpCatalogClient: ErpCatalogClient,
    private readonly cache: CacheService
  ) {}

  async syncCatalog() {
    const erpProducts = await this.erpCatalogClient.getProducts();
    const activeIds = erpProducts.map((product) => product.id);

    for (const erpProduct of erpProducts) {
      await this.prisma.$transaction(async (tx) => {
        const currentInventory = await tx.inventory.findUnique({
          where: { productId: erpProduct.id }
        });

        await tx.product.upsert({
          where: { id: erpProduct.id },
          update: {
            sku: erpProduct.sku,
            name: erpProduct.name,
            description: erpProduct.description,
            imageUrl: erpProduct.imageUrl,
            brand: erpProduct.brand,
            active: erpProduct.active
          },
          create: {
            id: erpProduct.id,
            sku: erpProduct.sku,
            name: erpProduct.name,
            description: erpProduct.description,
            imageUrl: erpProduct.imageUrl,
            brand: erpProduct.brand,
            active: erpProduct.active
          }
        });

        await tx.productPrice.upsert({
          where: { productId: erpProduct.id },
          update: {
            priceCents: erpProduct.priceCents,
            currency: 'BRL'
          },
          create: {
            productId: erpProduct.id,
            priceCents: erpProduct.priceCents,
            currency: 'BRL'
          }
        });

        await tx.inventory.upsert({
          where: { productId: erpProduct.id },
          update: {
            erpQty: erpProduct.erpQty,
            availableQty: Math.max(
              erpProduct.erpQty - (currentInventory?.reservedQty ?? 0),
              0
            ),
            version: { increment: 1 }
          },
          create: {
            productId: erpProduct.id,
            erpQty: erpProduct.erpQty,
            reservedQty: 0,
            availableQty: erpProduct.erpQty,
            version: 1
          }
        });

        await tx.productStats.upsert({
          where: { productId: erpProduct.id },
          update: {},
          create: {
            productId: erpProduct.id,
            popularityScore: 0,
            viewCount: 0,
            soldCount: 0
          }
        });

        await tx.productCompatibility.deleteMany({
          where: { productId: erpProduct.id }
        });

        for (const compatibility of erpProduct.compatibilities) {
          await tx.deviceModel.upsert({
            where: { slug: compatibility.slug },
            update: {
              brand: compatibility.brand,
              model: compatibility.model
            },
            create: {
              brand: compatibility.brand,
              model: compatibility.model,
              slug: compatibility.slug
            }
          });
        }

        if (erpProduct.compatibilities.length > 0) {
          const deviceModels = await Promise.all(
            erpProduct.compatibilities.map((compatibility) =>
              tx.deviceModel.findUniqueOrThrow({
                where: { slug: compatibility.slug }
              })
            )
          );

          await tx.productCompatibility.createMany({
            data: deviceModels.map((deviceModel) => ({
              productId: erpProduct.id,
              deviceModelId: deviceModel.id
            }))
          });
        }
      });
    }

    await this.prisma.product.updateMany({
      where: {
        id: {
          notIn: activeIds
        }
      },
      data: {
        active: false
      }
    });

    const catalogVersion = await this.prisma.catalogVersion.upsert({
      where: { key: 'catalog' },
      update: {
        version: {
          increment: 1
        }
      },
      create: {
        key: 'catalog',
        version: 1
      }
    });

    return {
      synced: erpProducts.length,
      catalogVersion: catalogVersion.version
    };
  }

  async reconcileOrders() {
    const orders = await this.prisma.order.findMany({
      where: {
        status: {
          in: ['PENDING_ERP', 'ERP_FAILED']
        }
      }
    });

    let repaired = 0;
    let divergences = 0;

    for (const order of orders) {
      const billing = await this.erpCatalogClient.getBillingStatus(order.id);

      if (billing?.invoiceId && order.status !== 'BILLED') {
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            status: 'BILLED',
            erpInvoiceId: billing.invoiceId,
            failureReason: null
          }
        });

        repaired += 1;
        continue;
      }

      if (!billing?.invoiceId) {
        divergences += 1;
      }
    }

    return {
      repaired,
      divergences
    };
  }
}
