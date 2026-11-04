-- Delivery: the engine follows each order's packages through Zinc every tick. When Zinc first sees
-- a package moving, and again when it marks the whole order delivered, the engine saves a zkTLS
-- proof of that milestone (order id, milestone, time; the carrier too, once shipped) to `proofs` as
-- type 'tracking', and posts its fingerprint: LOOTBOX|v1|<drop>|shipped|<hash>, then
-- LOOTBOX|v1|<drop>|delivered|<hash>.
--
-- Private, like the rest of the orders row. Tracking numbers and carrier scans are never copied
-- here (a carrier's page can show the delivery city or ZIP): only how many packages there are and
-- how they're doing. The old `shipments` table (made for AfterShip) stays unused.

alter table orders add column delivery_status text;            -- awaiting_tracking, pending, in_transit, available_for_pickup, undeliverable, delivered
alter table orders add column packages int;                     -- how many packages Zinc is following

alter table orders add column shipped_at timestamptz;           -- when Zinc saw the first package moving
alter table orders add column shipped_proof_id bigint references proofs(id);
alter table orders add column shipped_proof_hash text;
alter table orders add column shipped_memo_tx text;             -- LOOTBOX|v1|<drop>|shipped|<proof hash>

alter table orders add column delivered_at timestamptz;         -- when Zinc says the last package arrived
alter table orders add column delivered_proof_id bigint references proofs(id);
alter table orders add column delivered_proof_hash text;
alter table orders add column delivered_memo_tx text;           -- LOOTBOX|v1|<drop>|delivered|<proof hash>
