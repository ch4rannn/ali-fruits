-- LOCAL DEVELOPMENT SAMPLE DATA ONLY. Never run this against staging or production.
-- Names, prices and details below are placeholders so you can try every screen. The real
-- zones, products, prices and business details are entered by you in /admin.

-- Pretend the business checks are done so live ordering can be tried locally.
UPDATE business_settings SET value = 'true' WHERE key IN ('SELLER_DETAILS_VERIFIED', 'FSSAI_COVERAGE_VERIFIED', 'ONLINE_SALES_ENABLED');
UPDATE business_settings SET value = 'SAMPLE SELLER (development only)' WHERE key = 'legal_seller_name';
UPDATE business_settings SET value = 'Sample address, Sabzi Mandi, Kharar' WHERE key = 'business_address';
UPDATE business_settings SET value = '2099-12-31' WHERE key = 'fssai_valid_until';
UPDATE business_settings SET value = 'sample-upi@bank' WHERE key = 'upi_id';
UPDATE business_settings SET value = 'Sample Fruit Shop' WHERE key = 'upi_display_name';

INSERT INTO delivery_zones (id, name, slug, pin_codes, min_order_paise, delivery_charge_paise, small_order_below_paise, small_order_charge_paise, free_above_paise, quote_only, estimated_time, own_rider_enabled, third_party_enabled, publish_landing_page, landing_description, is_active, created_at, updated_at) VALUES
  ('zone-kharar', 'Kharar Main Market', 'kharar-main-market', '140301', 10000, 2500, 19900, 3000, 39900, 0, 'Within 2 hours', 1, 1, 0, '', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('zone-sunny', 'Sunny Enclave', 'sunny-enclave', '140301,140307', 10000, 2000, 19900, 3000, 39900, 0, 'Within 2 hours', 1, 0, 1, 'Sample description for the Sunny Enclave page.', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('zone-gharuan', 'Gharuan (not yet active)', 'gharuan', '140413', 30000, 5000, 0, 0, NULL, 1, 'Quoted per order', 1, 1, 0, '', 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');

INSERT INTO delivery_slots (id, zone_id, label, sort_order, is_active) VALUES
  ('slot-k1', 'zone-kharar', 'Morning, 9 am to 12 pm', 0, 1), ('slot-k2', 'zone-kharar', 'Evening, 5 pm to 8 pm', 1, 1),
  ('slot-s1', 'zone-sunny', 'Morning, 9 am to 12 pm', 0, 1), ('slot-s2', 'zone-sunny', 'Evening, 5 pm to 8 pm', 1, 1),
  ('slot-g1', 'zone-gharuan', 'Evening, 5 pm to 8 pm', 0, 1);

INSERT INTO products (id, category_id, name, slug, description, availability, is_featured, is_seasonal, is_combo, display_priority, is_active, created_at, updated_at) VALUES
  ('p-apple', 'cat-apples', 'Shimla Apple', 'shimla-apple', 'Sample product for development.', 'AVAILABLE', 1, 0, 0, 90, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('p-banana', 'cat-bananas', 'Banana', 'banana', 'Sample product for development.', 'AVAILABLE', 1, 0, 0, 80, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('p-grapes', 'cat-grapes', 'Green Grapes', 'green-grapes', 'Sample product for development.', 'AVAILABLE', 1, 1, 0, 70, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('p-orange', 'cat-oranges', 'Orange', 'orange', 'Sample product for development.', 'AVAILABLE', 1, 1, 0, 60, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('p-pomegranate', 'cat-pomegranates', 'Pomegranate', 'pomegranate', 'Sample product for development.', 'AVAILABLE', 0, 1, 0, 50, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('p-papaya', 'cat-papaya', 'Papaya', 'papaya', 'Sample product for development.', 'AVAILABLE', 0, 0, 0, 40, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('p-guava', 'cat-guava', 'Guava', 'guava', 'Sample product for development.', 'AVAILABLE', 0, 0, 0, 30, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('p-mango', 'cat-mangoes', 'Mango', 'mango', 'Sample product that is out of season, to show how unavailable fruit looks.', 'SEASONAL', 0, 1, 0, 20, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('p-box', 'cat-boxes', 'Student Fruit Box', 'student-fruit-box', 'Sample combination: apple, banana and orange.', 'AVAILABLE', 1, 0, 1, 10, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');

INSERT INTO product_variants (id, product_id, label, unit_kind, unit_size, retail_price_paise, wholesale_price_paise, min_qty, qty_step, is_active, sort_order, created_at, updated_at) VALUES
  ('v-apple-500', 'p-apple', '500 g', 'WEIGHT', 500, 9000, 6000, 1, 1, 1, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-apple-1k', 'p-apple', '1 kg', 'WEIGHT', 1000, 18000, 12000, 1, 1, 1, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-banana-dz', 'p-banana', '1 dozen', 'COUNT', 12, 6000, 4200, 1, 1, 1, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-banana-6', 'p-banana', '6 pieces', 'COUNT', 6, 3200, 2200, 1, 1, 1, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-grapes-500', 'p-grapes', '500 g', 'WEIGHT', 500, 5500, 3800, 1, 1, 1, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-grapes-1k', 'p-grapes', '1 kg', 'WEIGHT', 1000, 10500, 7400, 1, 1, 1, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-orange-1k', 'p-orange', '1 kg', 'WEIGHT', 1000, 8000, 5500, 1, 1, 1, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-orange-2k', 'p-orange', '2 kg', 'WEIGHT', 2000, 15500, 11000, 1, 1, 1, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-pom-1k', 'p-pomegranate', '1 kg', 'WEIGHT', 1000, 16000, 11500, 1, 1, 1, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-papaya-1', 'p-papaya', '1 piece', 'COUNT', 1, 5000, 3500, 1, 1, 1, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-guava-500', 'p-guava', '500 g', 'WEIGHT', 500, 4000, 2800, 1, 1, 1, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-mango-1k', 'p-mango', '1 kg', 'WEIGHT', 1000, 12000, 8500, 1, 1, 1, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('v-box-1', 'p-box', '1 box', 'COUNT', 1, 19900, 14000, 1, 1, 1, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');

INSERT INTO product_price_history (id, variant_id, retail_price_paise, wholesale_price_paise, effective_date, note, updated_by, created_at)
SELECT 'ph-' || id, id, retail_price_paise, wholesale_price_paise, '2026-11-01', 'Sample data', NULL, '2026-11-01T00:00:00.000Z' FROM product_variants;
