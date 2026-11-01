-- Starting data that is safe in every environment: editable categories, the supplier and empty settings.
-- No delivery zones or products are created here. Those are confirmed by the founders in /admin.

INSERT INTO product_categories (id, name, slug, sort_order, created_at, updated_at) VALUES
  ('cat-apples', 'Apples', 'apples', 10, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-bananas', 'Bananas', 'bananas', 20, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-grapes', 'Grapes', 'grapes', 30, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-oranges', 'Oranges', 'oranges', 40, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-sweet-lime', 'Sweet lime', 'sweet-lime', 50, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-pomegranates', 'Pomegranates', 'pomegranates', 60, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-mangoes', 'Mangoes', 'mangoes', 70, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-melons', 'Melons', 'melons', 80, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-papaya', 'Papaya', 'papaya', 90, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-guava', 'Guava', 'guava', 100, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-seasonal', 'Seasonal fruits', 'seasonal-fruits', 110, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-boxes', 'Mixed fruit boxes', 'mixed-fruit-boxes', 120, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
  ('cat-other', 'Other fruits', 'other-fruits', 130, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');

INSERT INTO suppliers (id, name, notes, created_at, updated_at) VALUES
  ('sup-default', 'Uncle''s Sabzi Mandi Shop', 'Sabzi Mandi, Kharar. Edit under Procurement.', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');

-- Empty values are shown as "not provided" on public pages. Nothing here invents a licence, GSTIN or address.
INSERT INTO business_settings (key, value, is_public, updated_at) VALUES
  ('brand_name', 'Ali Fruits', 1, '2026-11-01T00:00:00.000Z'),
  ('brand_tagline', 'Fresh fruit from your local Kharar store', 1, '2026-11-01T00:00:00.000Z'),
  ('logo_key', '', 1, '2026-11-01T00:00:00.000Z'),
  ('legal_seller_name', '', 1, '2026-11-01T00:00:00.000Z'),
  ('business_address', '', 1, '2026-11-01T00:00:00.000Z'),
  ('business_phone', '', 1, '2026-11-01T00:00:00.000Z'),
  ('whatsapp_number', '', 1, '2026-11-01T00:00:00.000Z'),
  ('support_email', '', 1, '2026-11-01T00:00:00.000Z'),
  ('fssai_number', '', 1, '2026-11-01T00:00:00.000Z'),
  ('fssai_category', '', 1, '2026-11-01T00:00:00.000Z'),
  ('fssai_valid_until', '', 1, '2026-11-01T00:00:00.000Z'),
  ('gstin', '', 1, '2026-11-01T00:00:00.000Z'),
  ('operating_hours', '', 1, '2026-11-01T00:00:00.000Z'),
  ('testimonials', '', 1, '2026-11-01T00:00:00.000Z'),
  ('page_about', '', 1, '2026-11-01T00:00:00.000Z'),
  ('page_privacy', '', 1, '2026-11-01T00:00:00.000Z'),
  ('page_terms', '', 1, '2026-11-01T00:00:00.000Z'),
  ('page_delivery', '', 1, '2026-11-01T00:00:00.000Z'),
  ('page_cancellation', '', 1, '2026-11-01T00:00:00.000Z'),
  ('page_refund', '', 1, '2026-11-01T00:00:00.000Z'),
  ('upi_id', '', 0, '2026-11-01T00:00:00.000Z'),
  ('upi_qr_key', '', 0, '2026-11-01T00:00:00.000Z'),
  ('upi_display_name', '', 0, '2026-11-01T00:00:00.000Z'),
  ('upi_instructions', '', 0, '2026-11-01T00:00:00.000Z'),
  ('delivery_otp_enabled', 'false', 0, '2026-11-01T00:00:00.000Z'),
  ('SELLER_DETAILS_VERIFIED', 'false', 0, '2026-11-01T00:00:00.000Z'),
  ('FSSAI_COVERAGE_VERIFIED', 'false', 0, '2026-11-01T00:00:00.000Z'),
  ('ONLINE_SALES_ENABLED', 'false', 0, '2026-11-01T00:00:00.000Z');
