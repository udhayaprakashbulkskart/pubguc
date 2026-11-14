'use strict';

/*
 * Sample catalog, inserted only when the products table is empty.
 * Names are generic placeholders. Replace them with items you are authorized to sell.
 * Prices are in paise (1 rupee = 100). Sample prices lie between Rs 10,000 and Rs 1,00,000.
 */

const CATEGORIES = [
  {
    slug: 'uc',
    name: 'UC Top-Up',
    description: 'In-game currency credited to your Player ID.',
    fulfilment: 'uc',
    sort_order: 1,
  },
  {
    slug: 'suits',
    name: 'Suits',
    description: 'Outfit sets for your character. One per Player ID.',
    fulfilment: 'cosmetic',
    sort_order: 2,
  },
  {
    slug: 'car-skins',
    name: 'Car Skins',
    description: 'Vehicle finishes. One per Player ID.',
    fulfilment: 'cosmetic',
    sort_order: 3,
  },
];

// [category, name, description, rarity, price_cents, uc_amount, popular]
const PRODUCTS = [
  ['uc', '60 UC', 'Starter pack.', 'common', 1000000, 60, 0],
  ['uc', '325 UC', 'Small pack.', 'common', 1500000, 325, 0],
  ['uc', '660 UC', 'Best value for regular players.', 'rare', 2500000, 660, 1],
  ['uc', '1,800 UC', 'Medium pack.', 'epic', 4000000, 1800, 0],
  ['uc', '3,850 UC', 'Large pack.', 'epic', 6500000, 3850, 0],
  ['uc', '8,100 UC', 'Biggest pack.', 'legendary', 10000000, 8100, 0],

  ['suits', 'Jungle Camo Suit', 'Woodland pattern, everyday wear.', 'common', 1000000, null, 0],
  ['suits', 'Desert Ranger Suit', 'Sand-toned utility outfit.', 'rare', 2500000, null, 0],
  ['suits', 'Frostline Suit', 'Insulated arctic styling.', 'epic', 5000000, null, 1],
  ['suits', 'Obsidian Elite Suit', 'Dark tactical full set.', 'legendary', 10000000, null, 0],

  ['car-skins', 'Rust Runner Skin', 'Weathered paint finish.', 'common', 1000000, null, 0],
  ['car-skins', 'Neon Drift Skin', 'Glowing accent livery.', 'rare', 2000000, null, 0],
  ['car-skins', 'Chrome Storm Skin', 'Mirror-polished metallic finish.', 'epic', 4000000, null, 1],
  ['car-skins', 'Gilded Phantom Skin', 'Gold-plated premium finish.', 'legendary', 8000000, null, 0],
];

/**
 * Inserts the sample catalog if the products table is empty.
 * `t` is a transaction handle from lib/db.js: t.query(sql, params) resolves to rows.
 */
async function seedCatalog(t) {
  const [{ n }] = await t.query('SELECT COUNT(*)::int AS n FROM products');
  if (n > 0) return;

  for (const c of CATEGORIES) {
    await t.query(
      `INSERT INTO categories (slug, name, description, fulfilment, sort_order)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING`,
      [c.slug, c.name, c.description, c.fulfilment, c.sort_order]
    );
  }

  const perCategory = {};
  for (const [category, name, description, rarity, price, uc, popular] of PRODUCTS) {
    perCategory[category] = (perCategory[category] || 0) + 1;
    await t.query(
      `INSERT INTO products (category, name, description, rarity, price_cents, uc_amount, popular, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [category, name, description, rarity, price, uc, popular === 1, perCategory[category]]
    );
  }
}

module.exports = { seedCatalog, CATEGORIES };
