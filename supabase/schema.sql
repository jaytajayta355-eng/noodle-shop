-- เตี๋ยวอิ่มใจ: database for Supabase.
-- Run the whole file once in Supabase Dashboard → SQL Editor → New query → Run.
-- It is safe to run again after edits (tables are kept, functions and policies are replaced).
--
-- Security model:
--   * Customers are anonymous. They never touch the orders table directly; they can only
--     place an order and read back orders whose secret access token they hold.
--   * Staff log in with Supabase Auth (email + password) and must be listed in public.staff.
--   * Prices are always recalculated here from public.menu; the browser's prices are ignored.
--   * Errors use SQLSTATE 'PTxxx', which PostgREST turns into HTTP status xxx.

-- ---------- Tables ----------
create table if not exists public.menu (
  id int primary key,
  name text not null,
  description text not null default '',
  price int not null check (price > 0),
  image text not null default '',
  available boolean not null default true,
  sort int not null default 0
);

create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create sequence if not exists public.order_number;

create table if not exists public.orders (
  id text primary key default 'A' || lpad(nextval('public.order_number')::text, 3, '0'),
  request_id text not null unique,
  token_hash text not null,
  customer jsonb not null,
  items jsonb not null,
  total int not null,
  status text not null default 'pending' check (status in ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
  version int not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists orders_created_at on public.orders (created_at desc);
create index if not exists orders_phone_recent on public.orders ((customer->>'phone'), created_at);

alter table public.menu enable row level security;
alter table public.staff enable row level security;
alter table public.orders enable row level security;

-- Only the menu is readable directly; everything else goes through the functions below.
revoke all on public.menu, public.staff, public.orders from anon, authenticated;
revoke all on sequence public.order_number from anon, authenticated;
grant select on public.menu to anon, authenticated;
drop policy if exists menu_read on public.menu;
create policy menu_read on public.menu for select to anon, authenticated using (true);

-- ---------- Helpers (not callable from the browser) ----------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = auth.uid())
$$;

create or replace function public.order_json(o public.orders) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'customer', o.customer, 'items', o.items, 'total', o.total,
    'status', o.status, 'version', o.version, 'createdAt', o.created_at)
$$;

create or replace function public.hash_token(token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(token, ''), 'UTF8')), 'hex')
$$;

create or replace function public.menu_json(m public.menu) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'name', m.name, 'description', m.description, 'price', m.price, 'image', m.image, 'available', m.available)
$$;

-- ---------- Customer functions ----------
create or replace function public.place_order(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  req text := payload->>'requestId';
  tok text := payload->>'accessToken';
  c jsonb := case when jsonb_typeof(payload->'customer') = 'object' then payload->'customer' else '{}'::jsonb end;
  v_name text := left(btrim(coalesce(c->>'name', '')), 80);
  v_phone text := left(btrim(coalesce(c->>'phone', '')), 10);
  v_type text := case when c->>'type' = 'takeaway' then 'takeaway' else 'dine-in' end;
  v_table text := left(btrim(coalesce(c->>'table', '')), 20);
  v_note text := left(btrim(coalesce(c->>'note', '')), 300);
  it jsonb;
  prod public.menu;
  qty int;
  price int;
  v_items jsonb := '[]'::jsonb;
  v_total int := 0;
  existing public.orders;
  created public.orders;
begin
  if req is null or tok is null or length(req) > 100 or length(tok) < 16 or length(tok) > 200 then
    raise exception using errcode = 'PT400', message = 'ข้อมูลออเดอร์ไม่ถูกต้อง';
  end if;

  -- Safe retry: the same requestId returns the order already created.
  select * into existing from public.orders where request_id = req;
  if found then
    if existing.token_hash <> public.hash_token(tok) then
      raise exception using errcode = 'PT409', message = 'ข้อมูลออเดอร์ไม่ถูกต้อง';
    end if;
    return public.order_json(existing);
  end if;

  if v_name = '' or v_phone !~ '^0[0-9]{8,9}$' or (v_type = 'dine-in' and v_table = '') then
    raise exception using errcode = 'PT400', message = 'กรุณากรอกชื่อ เบอร์โทร และหมายเลขโต๊ะให้ถูกต้อง';
  end if;
  if v_type = 'takeaway' then v_table := ''; end if;

  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') = 0 or jsonb_array_length(payload->'items') > 50 then
    raise exception using errcode = 'PT400', message = 'ไม่มีรายการอาหารในออเดอร์';
  end if;

  -- Basic abuse guard: at most 5 orders per phone number per 10 minutes.
  if (select count(*) from public.orders where customer->>'phone' = v_phone and created_at > now() - interval '10 minutes') >= 5 then
    raise exception using errcode = 'PT429', message = 'สั่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
  end if;

  for it in select value from jsonb_array_elements(payload->'items') loop
    if coalesce(it->>'productId', '') !~ '^[0-9]{1,9}$' then
      raise exception using errcode = 'PT400', message = 'ไม่พบเมนูที่สั่ง';
    end if;
    select * into prod from public.menu where id = (it->>'productId')::int;
    if not found then
      raise exception using errcode = 'PT400', message = 'ไม่พบเมนูที่สั่ง';
    end if;
    if not prod.available then
      raise exception using errcode = 'PT409', message = prod.name || ' หมดชั่วคราว กรุณาเลือกเมนูอื่น';
    end if;
    if coalesce(it->>'noodle', '') not in ('เส้นเล็ก', 'เส้นใหญ่', 'เส้นหมี่', 'บะหมี่', 'วุ้นเส้น', 'เกาเหลา')
       or coalesce(it->>'size', '') not in ('ธรรมดา', 'พิเศษ')
       or jsonb_typeof(it->'quantity') is distinct from 'number' or (it->>'quantity') !~ '^[0-9]{1,2}$' then
      raise exception using errcode = 'PT400', message = 'ตัวเลือกเมนูไม่ถูกต้อง';
    end if;
    qty := (it->>'quantity')::int;
    if qty < 1 or qty > 99 then
      raise exception using errcode = 'PT400', message = 'ตัวเลือกเมนูไม่ถูกต้อง';
    end if;
    price := prod.price + case when it->>'size' = 'พิเศษ' then 10 else 0 end;
    v_items := v_items || jsonb_build_object('productId', prod.id, 'name', prod.name, 'noodle', it->>'noodle', 'size', it->>'size',
      'note', left(btrim(coalesce(it->>'note', '')), 150), 'quantity', qty, 'price', price);
    v_total := v_total + price * qty;
  end loop;

  begin
    insert into public.orders (request_id, token_hash, customer, items, total)
    values (req, public.hash_token(tok),
      jsonb_build_object('name', v_name, 'phone', v_phone, 'type', v_type, 'table', v_table, 'note', v_note),
      v_items, v_total)
    returning * into created;
  exception when unique_violation then
    -- Two identical retries raced; return the one that won.
    select * into created from public.orders where request_id = req;
  end;
  return public.order_json(created);
end
$$;

create or replace function public.lookup_orders(refs jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.order_json(o) order by o.created_at desc), '[]'::jsonb)
  from public.orders o
  join (
    select r->>'id' as id, r->>'accessToken' as tok
    from jsonb_array_elements(case when jsonb_typeof(refs) = 'array' then refs else '[]'::jsonb end) r
    limit 30
  ) x on x.id = o.id and o.token_hash = public.hash_token(x.tok)
$$;

-- ---------- Staff functions ----------
create or replace function public.am_i_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff()
$$;

create or replace function public.staff_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception using errcode = 'PT401', message = 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  return (select coalesce(jsonb_agg(public.order_json(o) order by o.created_at desc), '[]'::jsonb)
          from (select * from public.orders order by created_at desc limit 300) o);
end
$$;

create or replace function public.set_order_status(p_id text, p_status text, p_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.is_staff() then
    raise exception using errcode = 'PT401', message = 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  select * into o from public.orders where id = p_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'ไม่พบออเดอร์';
  end if;
  if o.version is distinct from p_version then
    raise exception using errcode = 'PT409', message = 'ออเดอร์ถูกแก้ไขไปแล้ว กรุณาลองใหม่';
  end if;
  if not ((o.status = 'pending' and p_status in ('preparing', 'cancelled'))
       or (o.status = 'preparing' and p_status in ('ready', 'cancelled'))
       or (o.status = 'ready' and p_status = 'completed')) then
    raise exception using errcode = 'PT400', message = 'เปลี่ยนสถานะนี้ไม่ได้';
  end if;
  update public.orders set status = p_status, version = version + 1 where id = p_id returning * into o;
  return public.order_json(o);
end
$$;

create or replace function public.set_menu_available(p_id int, p_available boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.menu;
begin
  if not public.is_staff() then
    raise exception using errcode = 'PT401', message = 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  if p_available is null then
    raise exception using errcode = 'PT400', message = 'ข้อมูลไม่ถูกต้อง';
  end if;
  update public.menu set available = p_available where id = p_id returning * into m;
  if not found then
    raise exception using errcode = 'PT404', message = 'ไม่พบเมนู';
  end if;
  return public.menu_json(m);
end
$$;

-- ---------- Who may call what ----------
revoke execute on function public.is_staff(), public.order_json(public.orders), public.hash_token(text), public.menu_json(public.menu),
  public.place_order(jsonb), public.lookup_orders(jsonb), public.am_i_staff(), public.staff_orders(),
  public.set_order_status(text, text, int), public.set_menu_available(int, boolean) from public, anon, authenticated;
grant execute on function public.place_order(jsonb), public.lookup_orders(jsonb) to anon, authenticated;
grant execute on function public.am_i_staff(), public.staff_orders(), public.set_order_status(text, text, int),
  public.set_menu_available(int, boolean) to authenticated;

-- ---------- Starter menu (edit freely; image is a file in public/images or a full https URL) ----------
insert into public.menu (id, name, description, price, image, sort) values
  (1, 'ก๋วยเตี๋ยวหมูน้ำใส', 'น้ำซุปกระดูกหมูเคี่ยวนาน หมูสับ หมูชิ้น ลูกชิ้น', 45, 'noodle-1.jpg', 1),
  (2, 'ต้มยำหมู', 'ต้มยำรสจัดจ้าน ถั่วลิสงคั่ว มะนาวสด', 55, 'noodle-2.jpg', 2),
  (3, 'เย็นตาโฟ', 'น้ำแดงหอมเต้าหู้ยี้ ลูกชิ้นปลา เกี๊ยวทอด', 50, 'noodle-3.jpg', 3),
  (4, 'ก๋วยเตี๋ยวเรือ', 'น้ำตกเข้มข้น หมูตุ๋น กากหมูกรอบ', 50, 'noodle-4.jpg', 4),
  (5, 'บะหมี่เกี๊ยวหมูแดง', 'บะหมี่เส้นสด เกี๊ยวกุ้ง หมูแดงย่าง', 60, 'noodle-5.jpg', 5),
  (6, 'เกาเหลาเนื้อตุ๋น', 'เนื้อตุ๋นนุ่ม น้ำซุปเครื่องเทศ', 65, 'noodle-6.jpg', 6)
on conflict (id) do nothing;

-- ---------- Add a staff member ----------
-- 1) Supabase Dashboard → Authentication → Users → Add user (email + password, tick "Auto Confirm User").
-- 2) Run this, with that email:
--    insert into public.staff (user_id) select id from auth.users where email = 'staff@example.com' on conflict do nothing;
