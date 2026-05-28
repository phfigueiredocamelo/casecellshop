export interface ErpCatalogCompatibility {
  brand: string;
  model: string;
  slug: string;
}

export interface ErpCatalogProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  imageUrl: string;
  brand: string;
  active: boolean;
  priceCents: number;
  erpQty: number;
  compatibilities: ErpCatalogCompatibility[];
}

export function buildDemoCatalog(): ErpCatalogProduct[] {
  return [
    {
      id: 'prod_case_iphone_15_clear',
      sku: 'CASE-IP15-CLEAR',
      name: 'Capa Transparente iPhone 15',
      description: 'Capa transparente com borda reforcada para iPhone 15.',
      imageUrl: 'https://example.com/images/case-iphone-15-clear.jpg',
      brand: 'CaseCell',
      active: true,
      priceCents: 5990,
      erpQty: 18,
      compatibilities: [
        { brand: 'Apple', model: 'iPhone 15', slug: 'apple-iphone-15' }
      ]
    },
    {
      id: 'prod_case_iphone_15_pro_black',
      sku: 'CASE-IP15PRO-BLK',
      name: 'Capa Premium iPhone 15 Pro',
      description: 'Capa premium preta com acabamento fosco para iPhone 15 Pro.',
      imageUrl: 'https://example.com/images/case-iphone-15-pro-black.jpg',
      brand: 'CaseCell',
      active: true,
      priceCents: 7990,
      erpQty: 12,
      compatibilities: [
        { brand: 'Apple', model: 'iPhone 15 Pro', slug: 'apple-iphone-15-pro' }
      ]
    },
    {
      id: 'prod_case_galaxy_s24_blue',
      sku: 'CASE-S24-BLUE',
      name: 'Capa Silicone Galaxy S24',
      description: 'Capa de silicone azul para Galaxy S24.',
      imageUrl: 'https://example.com/images/case-s24-blue.jpg',
      brand: 'CaseCell',
      active: true,
      priceCents: 5490,
      erpQty: 25,
      compatibilities: [
        { brand: 'Samsung', model: 'Galaxy S24', slug: 'samsung-galaxy-s24' }
      ]
    },
    {
      id: 'prod_case_multifit_magsafe',
      sku: 'CASE-MAGSAFE-MULTI',
      name: 'Capa MagSafe Multi Fit',
      description: 'Capa com suporte MagSafe para modelos selecionados.',
      imageUrl: 'https://example.com/images/case-magsafe-multi.jpg',
      brand: 'CaseCell',
      active: true,
      priceCents: 8990,
      erpQty: 9,
      compatibilities: [
        { brand: 'Apple', model: 'iPhone 15', slug: 'apple-iphone-15' },
        { brand: 'Apple', model: 'iPhone 15 Pro', slug: 'apple-iphone-15-pro' }
      ]
    }
  ];
}

export function buildLargeCatalog(size = 5000): ErpCatalogProduct[] {
  const devices = [
    { brand: 'Apple', model: 'iPhone 15', slug: 'apple-iphone-15' },
    { brand: 'Apple', model: 'iPhone 15 Pro', slug: 'apple-iphone-15-pro' },
    { brand: 'Samsung', model: 'Galaxy S24', slug: 'samsung-galaxy-s24' },
    { brand: 'Samsung', model: 'Galaxy S24 Ultra', slug: 'samsung-galaxy-s24-ultra' },
    { brand: 'Motorola', model: 'Edge 50', slug: 'motorola-edge-50' }
  ];

  return Array.from({ length: size }, (_, index) => {
    const device = devices[index % devices.length];
    const variant = index + 1;

    return {
      id: `prod_seed_${variant}`,
      sku: `CASE-SEED-${variant.toString().padStart(5, '0')}`,
      name: `Capa ${device.model} ${variant}`,
      description: `Capa gerada para demonstracao do catalogo grande (${device.model}).`,
      imageUrl: `https://example.com/images/seed-${variant}.jpg`,
      brand: 'CaseCell',
      active: variant % 17 !== 0,
      priceCents: 3990 + (variant % 10) * 500,
      erpQty: 3 + (variant % 40),
      compatibilities: [device]
    };
  });
}
