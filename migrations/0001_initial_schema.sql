-- Zero-inventory platform schema. There are deliberately no stock, warehouse or replenishment tables:
-- products carry an availability flag only, and procurement rows exist only after customer approval.
-- Money is integer paise. Timestamps are UTC ISO-8601 strings.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN','OPERATIONS','DELIVERY_MANAGER','FINANCE','RIDER')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_rate_limits_expiry ON rate_limits(expires_at);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  is_blocked INTEGER NOT NULL DEFAULT 0,
  internal_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_customers_name ON customers(name);

CREATE TABLE product_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES product_categories(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (availability IN ('AVAILABLE','UNAVAILABLE','SEASONAL','TEMPORARILY_UNAVAILABLE')),
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_seasonal INTEGER NOT NULL DEFAULT 0,
  is_combo INTEGER NOT NULL DEFAULT 0,
  display_priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_products_listing ON products(is_active, display_priority DESC, name);
CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_images_product ON product_images(product_id, sort_order);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('WEIGHT','COUNT')),
  unit_size INTEGER NOT NULL,            -- grams for WEIGHT, pieces for COUNT
  retail_price_paise INTEGER NOT NULL,
  wholesale_price_paise INTEGER,         -- private: never selected by a public query
  min_qty INTEGER NOT NULL DEFAULT 1,
  qty_step INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_variants_product ON product_variants(product_id, sort_order);

CREATE TABLE product_price_history (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  retail_price_paise INTEGER NOT NULL,
  wholesale_price_paise INTEGER,
  effective_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_price_history_variant ON product_price_history(variant_id, created_at DESC);

CREATE TABLE delivery_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  pin_codes TEXT NOT NULL,
  min_order_paise INTEGER NOT NULL DEFAULT 0,
  delivery_charge_paise INTEGER NOT NULL DEFAULT 0,
  small_order_below_paise INTEGER NOT NULL DEFAULT 0,
  small_order_charge_paise INTEGER NOT NULL DEFAULT 0,
  free_above_paise INTEGER,
  quote_only INTEGER NOT NULL DEFAULT 0,
  estimated_time TEXT NOT NULL DEFAULT '',
  own_rider_enabled INTEGER NOT NULL DEFAULT 1,
  third_party_enabled INTEGER NOT NULL DEFAULT 0,
  publish_landing_page INTEGER NOT NULL DEFAULT 0,
  landing_description TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE delivery_slots (
  id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_slots_zone ON delivery_slots(zone_id, sort_order);

CREATE TABLE customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  zone_id TEXT REFERENCES delivery_zones(id),
  pin_code TEXT NOT NULL,
  locality TEXT NOT NULL,
  address_line TEXT NOT NULL,
  landmark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (customer_id, pin_code, address_line)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  tracking_token TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  order_type TEXT NOT NULL DEFAULT 'ORDER' CHECK (order_type IN ('ORDER','ENQUIRY')),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL,
  -- Delivery details are copied here so later edits to a customer never change past orders.
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  pin_code TEXT NOT NULL,
  locality TEXT NOT NULL,
  address_line TEXT NOT NULL,
  landmark TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  zone_id TEXT NOT NULL REFERENCES delivery_zones(id),
  slot_id TEXT REFERENCES delivery_slots(id),
  slot_label TEXT NOT NULL DEFAULT '',
  -- The customer's original estimate. Never updated after creation.
  estimated_subtotal_paise INTEGER NOT NULL,
  estimated_delivery_paise INTEGER NOT NULL,
  estimated_total_paise INTEGER NOT NULL,
  delivery_to_be_quoted INTEGER NOT NULL DEFAULT 0,
  -- Current confirmed or proposed amounts.
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  delivery_fee_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  other_charges_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  current_revision INTEGER NOT NULL DEFAULT 0,
  payment_preference TEXT NOT NULL,
  payment_method TEXT,
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  internal_notes TEXT NOT NULL DEFAULT '',
  customer_note TEXT NOT NULL DEFAULT '',
  delivered_at TEXT,
  settled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_customer ON orders(customer_id, created_at DESC);
CREATE INDEX idx_orders_settled ON orders(settled_at);
CREATE INDEX idx_orders_phone ON orders(customer_phone);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  product_name TEXT NOT NULL,
  variant_label TEXT NOT NULL,
  -- What the customer asked for. Null when staff added the line as a substitute.
  requested_qty INTEGER,
  requested_unit_price_paise INTEGER,
  -- What staff proposed or confirmed.
  confirmed_qty INTEGER,
  confirmed_unit_price_paise INTEGER,
  confirmed_line_total_paise INTEGER,
  line_status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (line_status IN ('REQUESTED','CONFIRMED','REMOVED','ADDED')),
  substitute_for_item_id TEXT REFERENCES order_items(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

CREATE TABLE order_revisions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  subtotal_paise INTEGER NOT NULL,
  delivery_fee_paise INTEGER NOT NULL,
  discount_paise INTEGER NOT NULL,
  other_charges_paise INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  customer_response TEXT CHECK (customer_response IN ('ACCEPT_ORDER','REJECT_ORDER','REQUEST_CHANGE')),
  response_note TEXT NOT NULL DEFAULT '',
  responded_at TEXT,
  UNIQUE (order_id, revision_number)
);

CREATE TABLE order_status_history (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_by_kind TEXT NOT NULL,
  changed_by_user_id TEXT REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_status_history_order ON order_status_history(order_id, created_at);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE procurement_records (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  order_item_id TEXT NOT NULL REFERENCES order_items(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  purchased_quantity INTEGER NOT NULL,
  unit TEXT NOT NULL,
  purchase_price_paise INTEGER,
  total_cost_paise INTEGER NOT NULL,
  purchased_at TEXT NOT NULL,
  responsible_employee TEXT NOT NULL DEFAULT '',
  invoice_reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_procurement_order ON procurement_records(order_id);
CREATE INDEX idx_procurement_item ON procurement_records(order_item_id);
CREATE INDEX idx_procurement_date ON procurement_records(purchased_at);
CREATE INDEX idx_procurement_product ON procurement_records(product_id);

CREATE TABLE riders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  phone TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT '',
  compensation_type TEXT NOT NULL CHECK (compensation_type IN ('PER_DELIVERY','PER_SHIFT','FIXED_DAILY','CUSTOM')),
  compensation_amount_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE delivery_batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  locality TEXT NOT NULL DEFAULT '',
  slot_label TEXT NOT NULL DEFAULT '',
  rider_id TEXT NOT NULL REFERENCES riders(id),
  total_cost_paise INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_batches_created ON delivery_batches(created_at DESC);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  batch_id TEXT REFERENCES delivery_batches(id),
  mode TEXT NOT NULL CHECK (mode IN ('OWN_RIDER','THIRD_PARTY')),
  rider_id TEXT REFERENCES riders(id),
  provider TEXT NOT NULL DEFAULT '',
  booking_reference TEXT NOT NULL DEFAULT '',
  booking_date TEXT,
  tracking_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('ASSIGNED','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','FAILED','CANCELLED')),
  actual_cost_paise INTEGER NOT NULL DEFAULT 0,
  delivery_otp TEXT,
  failure_reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_deliveries_order ON deliveries(order_id);
CREATE INDEX idx_deliveries_rider ON deliveries(rider_id, status);
CREATE INDEX idx_deliveries_batch ON deliveries(batch_id);
-- One open delivery per order, so a rider cannot be double-assigned.
CREATE UNIQUE INDEX idx_deliveries_one_open ON deliveries(order_id) WHERE status NOT IN ('FAILED','CANCELLED');

CREATE TABLE delivery_events (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  changed_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_delivery_events_delivery ON delivery_events(delivery_id, created_at);

CREATE TABLE payment_records (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('PAYMENT','REFUND')),
  method TEXT NOT NULL CHECK (method IN ('UPI','COD','OTHER')),
  amount_paise INTEGER NOT NULL,
  txn_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('PENDING','VERIFIED','FAILED')),
  source TEXT NOT NULL CHECK (source IN ('CUSTOMER','STAFF','RIDER')),
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  collected_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_order ON payment_records(order_id);
CREATE INDEX idx_payments_status ON payment_records(status, created_at DESC);
CREATE UNIQUE INDEX idx_payments_unique_ref ON payment_records(txn_ref) WHERE txn_ref <> '' AND kind = 'PAYMENT' AND status <> 'FAILED';

CREATE TABLE business_expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('PACKAGING','RIDER','THIRD_PARTY_DELIVERY','OTHER_VARIABLE','FIXED')),
  amount_paise INTEGER NOT NULL,
  expense_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  order_id TEXT REFERENCES orders(id),
  rider_id TEXT REFERENCES riders(id),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_expenses_date ON business_expenses(expense_date);
CREATE INDEX idx_expenses_order ON business_expenses(order_id);
CREATE INDEX idx_expenses_rider ON business_expenses(rider_id);

CREATE TABLE business_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  ticket_type TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  order_number TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  resolution TEXT NOT NULL DEFAULT '',
  resolved_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tickets_status ON support_tickets(status, created_at DESC);

CREATE TABLE notification_logs (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('ADMIN','CUSTOMER','RIDER')),
  channel TEXT NOT NULL CHECK (channel IN ('DASHBOARD','EMAIL','WHATSAPP_API','MANUAL_LINK')),
  status TEXT NOT NULL CHECK (status IN ('STORED','SENT','FAILED','NOT_CONFIGURED')),
  order_id TEXT REFERENCES orders(id),
  rider_id TEXT REFERENCES riders(id),
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_audience ON notification_logs(audience, read_at, created_at DESC);
CREATE INDEX idx_notifications_order ON notification_logs(order_id, created_at DESC);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  actor_label TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
