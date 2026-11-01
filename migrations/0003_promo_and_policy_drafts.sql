-- Promotional banner settings, and starter text for the public policy pages.
-- The drafts describe how the software really works and name no licence, address or fixed refund term.
-- Have them reviewed and adjust them in /admin under Business settings before taking live orders.

INSERT INTO business_settings (key, value, is_public, updated_at) VALUES
  ('promo_banner_key', '', 1, '2026-11-01T00:00:00.000Z'),
  ('promo_banner_alt', '', 1, '2026-11-01T00:00:00.000Z');

UPDATE business_settings SET updated_at = '2026-11-01T00:00:00.000Z', value = 'We are a local fresh-fruit delivery service working from the Sabzi Mandi in Kharar, Punjab.

We do not keep fruit in storage waiting for customers. When you place an order, we check what is available and what it costs that day, send you the final total, and buy your fruit only after you approve it. Then it is weighed, packed and delivered.' WHERE key = 'page_about';

UPDATE business_settings SET updated_at = '2026-11-01T00:00:00.000Z', value = '# Where we deliver

We deliver only to the areas listed on our Delivery areas page. Your PIN code is checked at checkout.

# Delivery charges

The delivery charge depends on your area and order value. You see an estimate before ordering and the final charge before you approve your order. For some longer distances we confirm the charge when we check your order.

# Delivery slots

Choose a preferred slot at checkout. Slots are a preference, and we will contact you if yours cannot be met.

# If nobody is available

If a rider cannot reach you, we will try to contact you and arrange another attempt where possible.' WHERE key = 'page_delivery';

UPDATE business_settings SET updated_at = '2026-11-01T00:00:00.000Z', value = '# Before we buy your fruit

You can cancel online from your order page at any time before we start buying your fruit. There is no charge. If you have already paid, we will arrange a refund of the amount we received.

# After we start buying

Fruit is bought specifically for your order, so the order can no longer be cancelled online. Please contact us and we will tell you what we can do.

# If we cancel

We may cancel an order if the fruit is unavailable or we cannot deliver to you. We will tell you why, and refund any amount we received.' WHERE key = 'page_cancellation';

UPDATE business_settings SET updated_at = '2026-11-01T00:00:00.000Z', value = '# Reporting a problem

If fruit arrives damaged, or an item is missing, please contact us as soon as you can through the Contact page or WhatsApp. Give your order number and tell us what went wrong.

# What happens next

We look at each report individually and decide whether a replacement or a full or partial refund is appropriate.

# How refunds are paid

Refunds are normally returned the way you paid. Cash payments are refunded by UPI or in cash, as we agree with you.' WHERE key = 'page_refund';

UPDATE business_settings SET updated_at = '2026-11-01T00:00:00.000Z', value = '# What we collect

When you order or contact us, we collect your name, mobile number, optional email address, delivery address and order details.

# How we use it

We use your details to check and deliver your order, contact you about it, handle payments, refunds and complaints, and keep the records a business needs. We do not sell your details.

# Who can see it

Only staff who need your details can see them. A rider sees your name, phone number and address only while delivering your order. We share your delivery details with a third-party delivery service only when one is used for your order.

# Payments

We do not collect or store card details. UPI payments are made in your own UPI app.

# On your device

Your cart and recent order links are saved in your browser on this device.

# Your choices

To ask about, correct or remove your details, contact us through the Contact page.' WHERE key = 'page_privacy';

UPDATE business_settings SET updated_at = '2026-11-01T00:00:00.000Z', value = '# Your order request

Placing an order on this site is a request. It is not accepted until we have checked availability and prices, sent you the final total and you have approved it.

# Prices

Prices shown are current retail prices and may change daily. The final price is the one you approve. If it changes, you may accept it, ask for a change or decline.

# Substitutes

If a fruit is unavailable, we may suggest a substitute. It is only included if you approve the revised order.

# Weights and natural produce

Fruit is natural produce, and size, colour and appearance vary.

# Payment

Pay by UPI or cash on delivery as you choose when approving your order. A UPI payment is confirmed only after we have checked it against our own account.

# Cancellations and refunds

Our cancellation and refund and replacement policies form part of these terms.

# Contact

See our Contact page and Seller details page.' WHERE key = 'page_terms';
