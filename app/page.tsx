"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseManufactureYear } from "./manufacture-year";

type Status = "Баталгаажсан" | "Хүлээгдэж буй" | "Суурилуулж байна" | "Дууссан" | "Цуцлагдсан" | "cancelled";
type Role = "admin" | "operator" | "mechanic";
type PreorderStatus = "new" | "contacted" | "converted" | "cancelled";
type Booking = {
  id: number;
  bookingNo: string;
  customer: string;
  phone: string;
  plate: string;
  vehicle: string;
  manufactureYear?: number | null;
  productId?: number;
  productName?: string;
  branch: string;
  date: string;
  time: string;
  totalPrice?: number;
  advance?: number;
  finalPaid?: number;
  receipt?: string;
  status: Status;
  advancePaid?: boolean;
  balancePaid?: boolean;
  advanceType?: string | null;
  advanceNote?: string;
};
type FormState = {
  customer: string;
  phone: string;
  plate: string;
  vehicle: string;
  manufactureYear: string;
  productId: string;
  branch: string;
  date: string;
  time: string;
  totalPrice: string;
  advance: string;
  receipt: string;
  advanceType: string;
  advanceNote: string;
};
type AppUser = {
  id: number;
  email: string;
  role: Role;
  active: boolean;
  protected?: boolean;
};
type Product = { id: number; name: string; price: number; active: boolean };
type PreBooking = {
  id: number;
  customer: string;
  phone: string;
  vehicle: string;
  plate: string | null;
  manufactureYear?: number | null;
  source: string;
  note: string;
  status: PreorderStatus;
  convertedBookingId?: number | null;
  createdAt: string;
  updatedAt: string;
};
type AuditLog = {
  id: number;
  actorEmail: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  entityRef: string | null;
  displayPlate?: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};
type DuplicateResult = {
  phoneMatch?: { customer: string; plate: string; latestBookingDate: string };
  plateHistory?: { plate: string; vehicle: string; manufactureYear: number | null; bookingNo: string; bookingDate: string; status: string };
  activeBooking?: { bookingNo: string; branch: string; bookingDate: string; bookingTime: string; status: string };
  exactDuplicate?: boolean;
};
const branches = ["16-ын салбар", "Нарны замын салбар", "3-р салбар"];
const BOOKING_CAPACITY = 3;
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID;
const BUILD_LABEL = BUILD_ID ? `v1.0.0 · ${BUILD_ID.slice(0, 7)}` : process.env.NODE_ENV === "development" ? "v1.0.0 · local" : "v1.0.0";
const roleLabel = (role: Role) => role === "admin" ? "Админ" : role === "operator" ? "Захиалгын ажилтан" : "Механик";
async function fetchWithTimeout(url: string, signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, 15000);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
const isActiveBooking = (booking: Booking) => booking.status !== "Цуцлагдсан" && booking.status !== "cancelled";
const money = new Intl.NumberFormat("mn-MN");
const iso = (d = new Date()) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};
const emptyForm = (date = iso()): FormState => ({
  customer: "",
  phone: "",
  plate: "",
  vehicle: "",
  manufactureYear: "",
  productId: "",
  branch: branches[0],
  date,
  time: "09:00",
  totalPrice: "",
  advance: "",
  receipt: "",
  advanceType: "",
  advanceNote: "",
});
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const balance = (b: Booking) =>
  Math.max(0, (b.totalPrice || 0) - (b.advance || 0) - (b.finalPaid || 0));
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("mn-MN", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T12:00:00`));
const preorderDate = (value: string) =>
  new Intl.DateTimeFormat("mn-MN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
const preorderSource = (source: string) =>
  source === "facebook" ? "Facebook" : source === "website" ? "Website" : "Гараар";
const preorderStatus = (status: PreorderStatus) =>
  status === "new"
    ? "Шинэ"
    : status === "contacted"
      ? "Холбогдсон"
      : status === "converted"
        ? "Үндсэн захиалга болсон"
        : "Цуцлагдсан";

export const dynamic = "force-dynamic";

export default function Home() {
  const [authStatus, setAuthStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading");
  const [dashboardStatus, setDashboardStatus] = useState<"loading" | "loaded" | "error">("loading");
  const requestControllerRef = useRef<AbortController | null>(null);
  const [view, setView] = useState<
    "dashboard" | "new" | "schedule" | "reports" | "users" | "preorders" | "audit"
  >("dashboard");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [preOrders, setPreOrders] = useState<PreBooking[]>([]);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [updatingBookingId, setUpdatingBookingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [weekStart, setWeekStart] = useState(iso());
  const [editing, setEditing] = useState<Booking | null>(null);
  const [me, setMe] = useState<{
    email: string;
    name: string;
    role: Role;
  } | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRole, setUserRole] = useState<Role>("operator");
  const [products, setProducts] = useState<Product[]>([]);
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [preorderForm, setPreorderForm] = useState({
    customer: "",
    phone: "",
    vehicle: "",
    plate: "",
    manufactureYear: "",
    note: "",
  });
  const [pendingPreorderId, setPendingPreorderId] = useState<number | null>(null);
  const [preorderSearch, setPreorderSearch] = useState("");
  const [preorderStatusFilter, setPreorderStatusFilter] = useState<PreorderStatus | "">("");
  const [preorderSourceFilter, setPreorderSourceFilter] = useState("");
  const [preorderModalOpen, setPreorderModalOpen] = useState(false);
  const [duplicateCheck, setDuplicateCheck] = useState<DuplicateResult | null>(null);
  const [preorderDuplicateCheck, setPreorderDuplicateCheck] = useState<DuplicateResult | null>(null);
  const loadInitialData = async (user: { role: Role }, signal: AbortSignal) => {
    const requests: Promise<unknown>[] = [fetchWithTimeout("/api/bookings", signal)];
    if (user.role === "admin") requests.push(fetchWithTimeout("/api/users", signal));
    if (user.role !== "mechanic") requests.push(fetchWithTimeout("/api/products", signal));
    if (user.role === "admin" || user.role === "operator") requests.push(fetchWithTimeout("/api/preorders", signal));
    const [bookingData, ...otherData] = await Promise.all(requests);
    setBookings((bookingData as { bookings?: Booking[] }).bookings || []);
    let index = 0;
    if (user.role === "admin") {
      setUsers((otherData[index++] as { users?: AppUser[] }).users || []);
    }
    if (user.role !== "mechanic") {
      setProducts((otherData[index++] as { products?: Product[] }).products || []);
    }
    if (user.role === "admin" || user.role === "operator") {
      setPreOrders((otherData[index] as { preBookings?: PreBooking[] }).preBookings || []);
    }
  };
  const reload = async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setDashboardStatus("loading");
    try {
      if (!me) throw new Error("Authenticated user is unavailable");
      await loadInitialData(me, controller.signal);
      setDashboardStatus("loaded");
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      console.error("Initial application data failed to load", error);
      setDashboardStatus("error");
      return false;
    }
  };
  const loadUsers = () =>
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => setUsers(d.users || []));
  const loadProducts = () =>
    fetch("/api/products")
      .then((r) => r.json())
      .then((d) => setProducts(d.products || []));
  const loadPreOrders = () =>
    fetch("/api/preorders")
      .then((r) => r.json())
      .then((d) => setPreOrders(d.preBookings || []))
      .catch(() => setPreOrders([]));
  useEffect(() => {
    const controller = new AbortController();
    requestControllerRef.current = controller;
    let active = true;
    let authResolved = false;
    (async () => {
      try {
        const data = await fetchWithTimeout("/api/me", controller.signal) as { user?: { role: Role; email: string; name: string } };
        if (!data.user) throw new Error("Authenticated user is missing");
        if (!active) return;
        setMe(data.user);
        setAuthStatus("authenticated");
        authResolved = true;
        await loadInitialData(data.user, controller.signal);
        if (!active || controller.signal.aborted) return;
        setDashboardStatus("loaded");
      } catch (error) {
        if (controller.signal.aborted || !active) return;
        console.error("Initial application startup failed", error);
        setDashboardStatus("error");
        if (!authResolved) {
          setAuthStatus("unauthenticated");
          window.location.replace("/login");
        }
      }
    })();
    return () => { active = false; controller.abort(); };
  }, []);
  const canEdit = me?.role === "admin" || me?.role === "operator",
    isMechanic = me?.role === "mechanic";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);
  useEffect(() => {
    if (view !== "new" || (!form.phone.trim() && !form.plate.trim())) {
      setDuplicateCheck(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ phone: form.phone, plate: form.plate, bookingDate: form.date, bookingTime: form.time });
      fetch(`/api/bookings/duplicate-check?${params}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() : { duplicate: null })
        .then((data: { duplicate?: DuplicateResult }) => setDuplicateCheck(data.duplicate || null))
        .catch(() => undefined);
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [view, form.phone, form.plate, form.date, form.time]);
  useEffect(() => {
    if (!preorderModalOpen || (!preorderForm.phone.trim() && !preorderForm.plate.trim())) {
      setPreorderDuplicateCheck(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ phone: preorderForm.phone, plate: preorderForm.plate });
      fetch(`/api/bookings/duplicate-check?${params}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() : { duplicate: null })
        .then((data: { duplicate?: DuplicateResult }) => setPreorderDuplicateCheck(data.duplicate || null))
        .catch(() => undefined);
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [preorderModalOpen, preorderForm.phone, preorderForm.plate]);
  const openNew = (date = iso(), branch = branches[0]) => {
    setForm(emptyForm(date));
    setForm((x) => ({ ...x, branch }));
    setNotice("");
    setView("new");
  };
  const visible = useMemo(() => {
    const k = search.toLowerCase().trim();
    return k
      ? bookings.filter((b) =>
          `${b.bookingNo} ${b.customer} ${b.phone} ${b.plate} ${b.vehicle}`
            .toLowerCase()
            .includes(k),
        )
      : bookings;
  }, [bookings, search]);
  const visiblePreorders = useMemo(() => {
    const query = preorderSearch.toLowerCase().trim();
    return preOrders.filter((item) => {
      const matchesQuery = !query || `${item.customer} ${item.phone} ${item.plate || ""}`.toLowerCase().includes(query);
      return matchesQuery && (!preorderStatusFilter || item.status === preorderStatusFilter) && (!preorderSourceFilter || item.source === preorderSourceFilter);
    });
  }, [preOrders, preorderSearch, preorderStatusFilter, preorderSourceFilter]);
  const today = bookings.filter((b) => b.date === iso() && isActiveBooking(b)),
    totalAdvance = bookings.reduce((s, b) => s + (b.advance || 0), 0),
    totalBalance = bookings.reduce((s, b) => s + balance(b), 0);
  if (authStatus === "loading" || (authStatus === "authenticated" && dashboardStatus === "loading")) return <BootScreen />;
  if (authStatus === "unauthenticated") return null;
  if (dashboardStatus === "error") return <AppLoadError onRetry={reload} />;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const selectedCount = bookings.filter((b) => b.branch === form.branch && b.date === form.date && isActiveBooking(b)).length;
    if (selectedCount >= BOOKING_CAPACITY) {
      setNotice("Энэ салбарын тухайн өдрийн 3 захиалгын орон тоо дүүрсэн байна.");
      return;
    }
    setSubmitting(true);
    try {
      let duplicateOverride = Boolean(duplicateCheck?.activeBooking && !duplicateCheck.exactDuplicate && window.confirm("Энэ автомашинд өөр идэвхтэй захиалга байна. Шинэ захиалга үргэлжлүүлэн үүсгэх үү?"));
      if (duplicateCheck?.activeBooking && !duplicateOverride && !duplicateCheck.exactDuplicate) return;
      const requestBody = { ...form, duplicateOverride };
      const r = await fetch(pendingPreorderId ? `/api/preorders/${pendingPreorderId}` : "/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const d = (await r.json()) as { booking?: Booking; error?: string };
      if (r.status === 409 && !duplicateOverride && d.error === "Энэ автомашинд идэвхтэй захиалга байна." && window.confirm("Энэ автомашинд өөр идэвхтэй захиалга байна. Шинэ захиалга үргэлжлүүлэн үүсгэх үү?")) {
        duplicateOverride = true;
        const retry = await fetch(pendingPreorderId ? `/api/preorders/${pendingPreorderId}` : "/api/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, duplicateOverride: true }) });
        const retryData = await retry.json() as { booking?: Booking; error?: string };
        if (!retry.ok || !retryData.booking) throw new Error(retryData.error || "Хадгалах боломжгүй.");
        setBookings((x) => [retryData.booking!, ...x]);
        setForm(emptyForm());
        setPendingPreorderId(null);
        setNotice(`${retryData.booking.bookingNo} амжилттай бүртгэгдлээ.`);
        setView("dashboard");
        return;
      }
      const booking = d.booking;
      if (!r.ok || !booking) throw new Error(d.error || "Хадгалах боломжгүй.");
      if (pendingPreorderId) setPreOrders((x) => x.map((item) => item.id === pendingPreorderId ? { ...item, status: "converted", convertedBookingId: booking.id } : item));
      setBookings((x) => [booking, ...x]);
      setForm(emptyForm());
      setPendingPreorderId(null);
      setNotice(`${booking.bookingNo} амжилттай бүртгэгдлээ.`);
      setView("dashboard");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Хадгалах боломжгүй.");
    } finally {
      setSubmitting(false);
    }
  }
  async function update(id: number, payload: Record<string, unknown>) {
    if (updatingBookingId !== null) return;
    setUpdatingBookingId(id);
    try {
      const r = await fetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = (await r.json()) as { booking?: Booking; error?: string };
      if (!r.ok || !d.booking)
        throw new Error(d.error || "Шинэчлэх боломжгүй.");
      setBookings((x) => x.map((b) => (b.id === id ? d.booking! : b)));
      setEditing(null);
      setNotice(`Захиалга #${id} шинэчлэгдлээ.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Шинэчлэх боломжгүй.");
    } finally {
      setUpdatingBookingId(null);
    }
  }
  async function removeBooking(id: number) {
    if (!confirm(`Захиалга #${id}-г устгах уу?`)) return;
    const r = await fetch(`/api/bookings/${id}`, { method: "DELETE" });
    const d = await r.json();
    if (r.ok) {
      setBookings((x) => x.filter((b) => b.id !== id));
      setNotice(`Захиалга #${id} устгагдлаа.`);
    } else setNotice(d.error || "Устгах боломжгүй.");
  }
  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: userEmail,
        password: userPassword,
        role: userRole,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      setNotice(d.error || "Хэрэглэгч хадгалах боломжгүй.");
      return;
    }
    setUserEmail("");
    setUserPassword("");
    setNotice("Хэрэглэгчийн эрх хадгалагдлаа.");
    loadUsers();
  }
  async function changeUser(id: number, payload: Record<string, unknown>) {
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    loadUsers();
  }
  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: productName, price: Number(productPrice) }),
    });
    const d = await r.json();
    if (!r.ok) {
      setNotice(d.error || "Бүтээгдэхүүн хадгалах боломжгүй.");
      return;
    }
    setProductName("");
    setProductPrice("");
    setNotice("Бүтээгдэхүүн амжилттай бүртгэгдлээ.");
    loadProducts();
  }
  async function changeProduct(id: number, payload: Record<string, unknown>) {
    const r = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) loadProducts();
  }
  async function createPreorder(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      ...preorderForm,
      source: "manual",
      status: "new",
      honeypot: "",
    };
    const r = await fetch("/api/preorders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = (await r.json()) as { error?: string; preBooking?: PreBooking };
    if (!r.ok || !d.preBooking) {
      setNotice(d.error || "Урьдчилсан захиалга хадгалах боломжгүй.");
      return;
    }
    setPreorderForm({
      customer: "",
      phone: "",
      vehicle: "",
      plate: "",
      manufactureYear: "",
      note: "",
    });
    setPreOrders((x) => [d.preBooking!, ...x]);
    setNotice("Урьдчилсан захиалга амжилттай бүртгэгдлээ.");
    setPreorderModalOpen(false);
    setView("preorders");
  }
  async function updatePreorderStatus(id: number, status: PreorderStatus) {
    const r = await fetch(`/api/preorders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const d = (await r.json()) as { error?: string; preBooking?: PreBooking };
    if (!r.ok || !d.preBooking) {
      setNotice(d.error || "Төлөв шинэчлэх боломжгүй.");
      return;
    }
    setPreOrders((x) =>
      x.map((item) => (item.id === id ? d.preBooking! : item)),
    );
    setNotice("Урьдчилсан захиалгын төлөв шинэчлэгдлээ.");
  }
  async function updatePreorderYear(id: number, value: string) {
    const result = parseManufactureYear(value);
    if (result.error) {
      setNotice(result.error);
      return;
    }
    const response = await fetch(`/api/preorders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manufactureYear: result.year }),
    });
    const data = await response.json() as { error?: string; preBooking?: PreBooking };
    if (!response.ok || !data.preBooking) {
      setNotice(data.error || "Үйлдвэрлэсэн оныг хадгалах боломжгүй.");
      return;
    }
    setPreOrders((items) => items.map((item) => item.id === id ? data.preBooking! : item));
    setNotice("Үйлдвэрлэсэн он хадгалагдлаа.");
  }
  function convertPreorder(item: PreBooking) {
    if (pendingPreorderId !== null || submitting) return;
    if (item.status === "converted" || item.convertedBookingId) {
      setNotice(
        "Энэ урьдчилсан захиалга аль хэдийн үндсэн захиалгад хөрвүүлэгдсэн байна.",
      );
      return;
    }
    setPendingPreorderId(item.id);
    setForm({
      customer: item.customer,
      phone: item.phone,
      plate: item.plate || "",
      vehicle: item.vehicle,
      manufactureYear: item.manufactureYear ? String(item.manufactureYear) : "",
      productId: "",
      branch: branches[0],
      date: iso(),
      time: "09:00",
      totalPrice: "",
      advance: "",
      receipt: "",
      advanceType: "",
      advanceNote: "",
    });
    setNotice(
      "Үндсэн захиалга үүсгэхийн тулд бүтээгдэхүүн, салбар, цагийг сонгоно уу.",
    );
    setView("new");
  }
  function changeView(next: typeof view) {
    setMobileMenuOpen(false);
    if (next === "new") openNew();
    else {
      setView(next);
      setNotice("");
    }
  }
  const navigation = (
    <>
      <Nav a={view === "dashboard"} i="dashboard" on={() => changeView("dashboard")}>Хяналтын самбар</Nav>
      {canEdit && <Nav a={view === "new"} i="plus" on={() => changeView("new")}>Шинэ захиалга</Nav>}
      {canEdit && <Nav a={view === "preorders"} i="preorder" on={() => changeView("preorders")}>Урьдчилсан захиалга</Nav>}
      <Nav a={view === "schedule"} i="calendar" on={() => changeView("schedule")}>Цагийн хуваарь</Nav>
      {!isMechanic && <Nav a={view === "reports"} i="chart" on={() => changeView("reports")}>Тайлан</Nav>}
      {me?.role === "admin" && <Nav a={view === "users"} i="settings" on={() => changeView("users")}>Эрхийн тохиргоо</Nav>}
      {me?.role === "admin" && <Nav a={view === "audit"} i="history" on={() => changeView("audit")}>Үйл ажиллагааны түүх</Nav>}
    </>
  );
  return (
    <main className={`app-shell ${isMechanic ? "mechanic-view" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">G</span>
          <div>
            <strong>Грийн Энжин</strong>
            <small>Газ сервис</small>
          </div>
        </div>
        <nav>{navigation}</nav>
        <UserBlock user={me} buildLabel={BUILD_LABEL} />
        <a className="operator-signout" href="/api/auth/signout">Систем гарах</a>
      </aside>
      <div className="mobile-header">
        <div className="brand"><span className="brand-mark">G</span><strong>Грийн Энжин</strong></div>
        <button className="menu-toggle" aria-label="Цэс нээх" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)}>
          <span /><span /><span />
        </button>
      </div>
      {mobileMenuOpen && <div className="drawer-backdrop" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`mobile-drawer ${mobileMenuOpen ? "open" : ""}`} aria-label="Навигацийн цэс">
        <div className="drawer-head"><div className="brand"><span className="brand-mark">G</span><div><strong>Грийн Энжин</strong><small>Газ сервис</small></div></div><button className="drawer-close" aria-label="Цэс хаах" onClick={() => setMobileMenuOpen(false)}>×</button></div>
        <UserBlock user={me} />
        <nav>{navigation}</nav>
        <a className="operator-signout" href="/api/auth/signout">Систем гарах</a>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <p className="eyebrow">{dateLabel(iso()).toUpperCase()}</p>
            <h1>
              {view === "new"
                ? "Шинэ захиалга"
                : view === "schedule"
                  ? "Цагийн хуваарь"
                  : view === "reports"
                    ? "Тайлан, төлбөр"
                    : view === "users"
                      ? "Хэрэглэгчийн эрх"
                      : view === "audit"
                        ? "Үйл ажиллагааны түүх"
                      : view === "preorders"
                        ? "Урьдчилсан захиалга"
                        : "Хяналтын самбар"}
            </h1>
            <p className="page-subtitle">
              {view === "dashboard"
                ? "Өнөөдрийн захиалга, салбарын багтаамж"
                : view === "new"
                  ? "Харилцагчийн мэдээлэл болон үйлчилгээний хуваарь"
                  : view === "schedule"
                    ? "Салбар бүр өдөрт 3 захиалга"
                    : view === "reports"
                      ? "Төлбөр болон захиалгын нэгдсэн мэдээлэл"
                      : view === "users"
                        ? "Хэрэглэгчийн эрх болон бүтээгдэхүүний тохиргоо"
                        : view === "audit"
                          ? "Системд хийгдсэн өөрчлөлтийн бүртгэл"
                        : "Захиалгын өмнөх хүсэлтүүд"}
            </p>
          </div>
          {canEdit && (
            <button
              className="primary"
              onClick={() =>
                view === "preorders" ? setPreorderModalOpen(true) : openNew()
              }
            >
              {view === "preorders" ? "＋ Урьдчилсан захиалга" : "＋ Шинэ захиалга"}
            </button>
          )}
        </header>
        {notice && (
          <div
            className={
              notice.includes("амжилттай") || notice.includes("шинэчлэгдлээ")
                ? "notice success"
                : "notice"
            }
          >
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {view === "dashboard" && (
          <>
            <section className="stats">
              <Stat
                l="Өнөөдрийн захиалга"
                v={`${today.length}/9`}
                n="Салбар бүр өдөрт 3 машин"
                t="blue"
              />
              <Stat
                l="Баталгаажсан"
                v={`${bookings.filter((b) => b.status === "Баталгаажсан").length}`}
                n="Урьдчилгаа төлсөн"
                t="green"
              />
              <Stat
                l="Нийт урьдчилгаа"
                v={`${money.format(totalAdvance)}₮`}
                n="Бүртгэсэн төлбөр"
                t="violet"
              />
              <Stat
                l="Авах үлдэгдэл"
                v={`${money.format(totalBalance)}₮`}
                n="Ажил дуусахад авна"
                t="amber"
              />
            </section>
            <section className="dashboard-grid">
              <div className="panel wide">
                <div className="panel-head">
                  <div>
                    <h2>Захиалгын бүртгэл</h2>
                    <p>Хуваарь болон төлбөрийн нэгдсэн мэдээлэл</p>
                  </div>
                  <input
                    aria-label="Хайх"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Нэр, утас, улсын дугаар…"
                  />
                </div>
                <BookingTable
                  rows={visible}
                  onEdit={setEditing}
                  onComplete={(b) =>
                    update(b.id, { finalPaid: balance(b), status: "Дууссан" })
                  }
                  loading={dashboardStatus === "loading"}
                />
              </div>
              <div className="panel branch-panel">
                <div className="panel-head">
                  <div>
                    <h2>Өнөөдрийн салбарууд</h2>
                    <p>Салбар бүр өдөрт 3 машин</p>
                  </div>
                </div>
                {branches.map((branch) => {
                  const branchBookings = today.filter((b) => b.branch === branch);
                  const count = branchBookings.length;
                  return (
                    <div className="branch-day" key={branch}>
                      <div>
                        <b>{branch}</b>
                        <small>
                          {count === BOOKING_CAPACITY
                            ? "Дүүрсэн"
                            : count === 0
                              ? "3 орон тоо үлдсэн"
                              : `${BOOKING_CAPACITY - count} орон тоо үлдсэн`}
                        </small>
                      </div>
                      <span className={count > 0 ? "busy-dot" : "free-dot"}>
                        {count}/{BOOKING_CAPACITY}
                      </span>
                    </div>
                  );
                })}
                <button className="soft" onClick={() => setView("schedule")}>
                  Бүх хуваарийг харах →
                </button>
              </div>
            </section>
          </>
        )}
        {view === "new" && (
          <section className="form-layout">
            <form className="booking-form" onSubmit={submit}>
              <Form n="1" title="Харилцагчийн мэдээлэл">
                <div className="fields two">
                  <Field label="Овог, нэр *">
                    <input
                      required
                      value={form.customer}
                      onChange={(e) =>
                        setForm({ ...form, customer: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Утасны дугаар *">
                    <input
                      required
                      value={form.phone}
                      onChange={(e) =>
                        setForm({ ...form, phone: e.target.value })
                      }
                    />
                  </Field>
                </div>
              </Form>
              <Form n="2" title="Автомашины мэдээлэл">
                <div className="fields two">
                  <Field label="Улсын дугаар *">
                    <input
                      required
                      value={form.plate}
                      onChange={(e) =>
                        setForm({ ...form, plate: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Марк, загвар *">
                    <input
                      required
                      value={form.vehicle}
                      onChange={(e) =>
                        setForm({ ...form, vehicle: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Үйлдвэрлэсэн он *">
                    <input required maxLength={4} type="number" inputMode="numeric" min="1950" max={new Date().getFullYear() + 1} value={form.manufactureYear} onChange={(e) => setForm({ ...form, manufactureYear: e.target.value })} />
                  </Field>
                </div>
                {duplicateCheck?.phoneMatch && <DuplicateNotice>⚠ {"Энэ утасны дугаараар өмнө бүртгэл байна."}<small>{duplicateCheck.phoneMatch.customer} · {duplicateCheck.phoneMatch.plate || "Улсын дугааргүй"} · Сүүлд {duplicateCheck.phoneMatch.latestBookingDate}</small></DuplicateNotice>}
                {duplicateCheck?.plateHistory && !duplicateCheck.exactDuplicate && <DuplicateNotice>⚠ {duplicateCheck.activeBooking ? "Энэ автомашинд идэвхтэй захиалга байна." : "Энэ автомашин өмнө бүртгэгдсэн байна."}<small>{duplicateCheck.activeBooking ? `${duplicateCheck.activeBooking.bookingNo} · ${duplicateCheck.activeBooking.branch} · ${duplicateCheck.activeBooking.bookingDate} · ${duplicateCheck.activeBooking.bookingTime}` : `${duplicateCheck.plateHistory.vehicle} · ${duplicateCheck.plateHistory.manufactureYear || "Он тодорхойгүй"} · ${duplicateCheck.plateHistory.bookingNo}`}</small></DuplicateNotice>}
                {duplicateCheck?.exactDuplicate && <DuplicateNotice error>⚠ Энэ автомашин тухайн өдөр, цагт аль хэдийн бүртгэгдсэн байна.</DuplicateNotice>}
              </Form>
              <Form n="3" title="Салбар ба хуваарь">
                <div className="fields three">
                  <Field label="Салбар">
                    <select
                      value={form.branch}
                      onChange={(e) =>
                        setForm({ ...form, branch: e.target.value })
                      }
                    >
                      {branches.map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Өдөр">
                    <input
                      type="date"
                      min={iso()}
                      value={form.date}
                      onChange={(e) =>
                        setForm({ ...form, date: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Ирэх цаг">
                    <input
                      type="time"
                      value={form.time}
                      onChange={(e) =>
                        setForm({ ...form, time: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <p className="form-hint">
                  {(() => {
                    const count = bookings.filter((b) => b.branch === form.branch && b.date === form.date && isActiveBooking(b)).length;
                    return count >= BOOKING_CAPACITY ? "Энэ өдөр захиалга дүүрсэн байна." : `${BOOKING_CAPACITY - count} орон тоо үлдсэн`;
                  })()}
                </p>
              </Form>
              <Form n="4" title="Үнийн мэдээлэл">
                <div className="fields three">
                  <Field label="Бүтээгдэхүүн *">
                    <select
                      required
                      value={form.productId}
                      onChange={(e) => {
                        const p = products.find(
                          (x) => x.id === Number(e.target.value),
                        );
                        setForm({
                          ...form,
                          productId: e.target.value,
                          totalPrice: p ? String(p.price) : "",
                        });
                      }}
                    >
                      <option value="">Сонгоно уу</option>
                      {products
                        .filter((p) => p.active)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {money.format(p.price)}₮
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Нийт үнэ">
                    <input
                      readOnly
                      value={
                        form.totalPrice
                          ? `${money.format(Number(form.totalPrice))}₮`
                          : "Бүтээгдэхүүн сонгоно уу"
                      }
                    />
                  </Field>
                  <Field label="Урьдчилгаа">
                    <input
                      type="number"
                      min="0"
                      max={form.totalPrice || undefined}
                      value={form.advance}
                      onChange={(e) =>
                        setForm({ ...form, advance: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="fields two">
                  <Field label="Үлдэгдэл">
                    <input
                      readOnly
                      value={`${money.format(Math.max(0, Number(form.totalPrice) - Number(form.advance)))}₮`}
                    />
                  </Field>
                  <Field label="Нэмэлт мэдээлэл">
                    <input
                      value={form.receipt}
                      onChange={(e) =>
                        setForm({ ...form, receipt: e.target.value })
                      }
                    />
                  </Field>
                </div>
              </Form>
              <div className="form-actions">
                <button
                  type="button"
                  className="cancel"
                  onClick={() => changeView("dashboard")}
                >
                  Цуцлах
                </button>
                <button className="primary" disabled={submitting}>{submitting ? "Хадгалж байна..." : "Захиалга баталгаажуулах"}</button>
              </div>
            </form>
            <aside className="summary-card">
              <p className="eyebrow">ЗАХИАЛГЫН ХУРААНГУЙ</p>
              <h3>{form.vehicle || "Автомашины загвар"}</h3>
              <p>{form.plate || "Улсын дугаар"}</p>
              <hr />
              <dl>
                <div>
                  <dt>Бүтээгдэхүүн</dt>
                  <dd>
                    {products.find((p) => p.id === Number(form.productId))
                      ?.name || "Сонгоогүй"}
                  </dd>
                </div>
                <div>
                  <dt>Салбар</dt>
                  <dd>{form.branch}</dd>
                </div>
                <div>
                  <dt>Хуваарь</dt>
                  <dd>
                    {form.date} · {form.time}
                  </dd>
                </div>
                <div>
                  <dt>Нийт үнэ</dt>
                  <dd>{money.format(Number(form.totalPrice) || 0)}₮</dd>
                </div>
                <div>
                  <dt>Урьдчилгаа</dt>
                  <dd>{money.format(Number(form.advance) || 0)}₮</dd>
                </div>
                <div className="balance-line">
                  <dt>Үлдэгдэл</dt>
                  <dd>
                    {money.format(
                      Math.max(
                        0,
                        Number(form.totalPrice) - Number(form.advance),
                      ),
                    )}
                    ₮
                  </dd>
                </div>
              </dl>
            </aside>
          </section>
        )}
        {view === "schedule" && (
          <section className="panel schedule-board">
            <div className="panel-head">
              <div>
                <h2>{dateLabel(weekStart)}-с эхлэх 7 хоног</h2>
                <p>Салбар бүр өдөрт 3 захиалга</p>
              </div>
              <div className="week-nav">
                <button onClick={() => setWeekStart(addDays(weekStart, -7))}>
                  ← Өмнөх
                </button>
                <button onClick={() => setWeekStart(iso())}>Өнөөдөр</button>
                <button onClick={() => setWeekStart(addDays(weekStart, 7))}>
                  Дараах →
                </button>
              </div>
            </div>
            <div className="calendar-seven">
              {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map(
                (date) => (
                  <div className="calendar-day" key={date}>
                    <h3>{dateLabel(date)}</h3>
                    {branches.map((branch) => {
                      const branchBookings = bookings.filter((x) => x.date === date && x.branch === branch && isActiveBooking(x));
                      return <div key={branch}>
                        <div className="schedule-branch-head">
                          <b>{branch}</b>
                          <span className={branchBookings.length === BOOKING_CAPACITY ? "busy-dot" : "free-dot"}>
                            {branchBookings.length}/{BOOKING_CAPACITY}
                          </span>
                        </div>
                        {branchBookings.map((b) => (
                          <button className="day-booked" key={b.id} onClick={() => setEditing(b)}>
                            <span className="schedule-time">{b.time}</span>
                            <strong>{b.plate}</strong>
                            <span>{b.vehicle}</span>
                            <small>{b.bookingNo} · {b.customer}</small>
                            <em>Хуваарь өөрчлөх</em>
                          </button>
                        ))}
                        {branchBookings.length < BOOKING_CAPACITY && (
                          <button className="day-free" onClick={() => openNew(date, branch)}>
                            <span>＋ Захиалга авах</span><small>{BOOKING_CAPACITY - branchBookings.length} орон тоо үлдсэн</small>
                          </button>
                        )}
                      </div>;
                    })}
                  </div>
                ),
              )}
            </div>
          </section>
        )}
        {view === "reports" && (
          <>
            <section className="stats">
              <Stat
                l="Нийт үнэ"
                v={`${money.format(bookings.reduce((s, b) => s + (b.totalPrice || 0), 0))}₮`}
                n="Бүх захиалга"
                t="blue"
              />
              <Stat
                l="Урьдчилгаа"
                v={`${money.format(totalAdvance)}₮`}
                n="Хүлээн авсан"
                t="green"
              />
              <Stat
                l="Үлдэгдэл авсан"
                v={`${money.format(bookings.reduce((s, b) => s + (b.finalPaid || 0), 0))}₮`}
                n="Дууссан ажлууд"
                t="violet"
              />
              <Stat
                l="Авах үлдэгдэл"
                v={`${money.format(totalBalance)}₮`}
                n="Нээлттэй авлага"
                t="amber"
              />
            </section>
            <div className="panel">
              <BookingTable
                rows={visible}
                onEdit={setEditing}
                onComplete={(b) =>
                  update(b.id, { finalPaid: balance(b), status: "Дууссан" })
                }
                loading={dashboardStatus === "loading"}
              />
            </div>
          </>
        )}
        {view === "audit" && <AuditLogView />}
        {view === "users" && (
          <section className="users-layout">
            <form className="panel user-form" onSubmit={saveUser}>
              <div className="panel-head">
                <div>
                  <h2>Хэрэглэгч нэмэх</h2>
                  <p>Имэйл, password болон эрх онооно</p>
                </div>
              </div>
              <div className="user-form-body">
                <Field label="Имэйл хаяг">
                  <input
                    type="email"
                    required
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="name@email.com"
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    placeholder="Хамгийн багадаа 8 тэмдэгт"
                  />
                </Field>
                <Field label="Хэрэглэгчийн эрх">
                  <select
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value as Role)}
                  >
                    <option value="operator">Захиалгын оператор</option>
                    <option value="mechanic">Механик</option>
                    <option value="admin">Админ</option>
                  </select>
                </Field>
                <button className="primary">Эрх нэмэх</button>
              </div>
            </form>
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>Бүртгэлтэй хэрэглэгчид</h2>
                  <p>Админ хэрэглэгчдийн эрхийг эндээс удирдана</p>
                </div>
              </div>
              <div className="user-list">
                {users.map((u) => (
                  <div className="user-row" key={`${u.id}-${u.email}`}>
                    <div>
                      <b>{u.email}</b>
                      <small>{u.protected ? "Үндсэн админ" : "Ажилтан"}</small>
                    </div>
                    <select
                      disabled={u.protected}
                      value={u.role}
                      onChange={(e) =>
                        changeUser(u.id, { role: e.target.value })
                      }
                    >
                      <option value="admin">Админ</option>
                      <option value="operator">Оператор</option>
                      <option value="mechanic">Механик</option>
                    </select>
                    <button
                      disabled={u.protected}
                      className={u.active ? "deactivate" : "activate"}
                      onClick={() => changeUser(u.id, { active: !u.active })}
                    >
                      {u.active ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
        {view === "users" && (
          <section className="product-admin">
            <form className="panel product-form" onSubmit={saveProduct}>
              <div className="panel-head">
                <div>
                  <h2>Бүтээгдэхүүн нэмэх</h2>
                  <p>Захиалгад сонгох бүтээгдэхүүн, үндсэн үнэ</p>
                </div>
              </div>
              <div className="product-form-body">
                <Field label="Бүтээгдэхүүний нэр">
                  <input
                    required
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="Жишээ: 4 цилиндр газан систем"
                  />
                </Field>
                <Field label="Үнийн дүн">
                  <input
                    required
                    type="number"
                    min="1"
                    value={productPrice}
                    onChange={(e) => setProductPrice(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <button className="primary">Бүтээгдэхүүн бүртгэх</button>
              </div>
            </form>
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>Бүтээгдэхүүний бүртгэл</h2>
                  <p>Нэр, үнэ болон захиалгад харагдах төлөв</p>
                </div>
              </div>
              <div className="product-list">
                {products.length === 0 && (
                  <div className="empty">Бүтээгдэхүүн бүртгээгүй байна.</div>
                )}
                {products.map((p) => (
                  <div className="product-row" key={p.id}>
                    <input
                      aria-label="Бүтээгдэхүүний нэр"
                      defaultValue={p.name}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== p.name)
                          changeProduct(p.id, { name: e.target.value });
                      }}
                    />
                    <input
                      aria-label="Үнийн дүн"
                      type="number"
                      min="1"
                      defaultValue={p.price}
                      onBlur={(e) => {
                        if (Number(e.target.value) !== p.price)
                          changeProduct(p.id, {
                            price: Number(e.target.value),
                          });
                      }}
                    />
                    <span>{money.format(p.price)}₮</span>
                    <button
                      className={p.active ? "deactivate" : "activate"}
                      onClick={() => changeProduct(p.id, { active: !p.active })}
                    >
                      {p.active ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
        {view === "preorders" && (
          <section className="panel preorder-panel">
            <div className="panel-head">
              <div>
                <h2>Урьдчилсан захиалга</h2>
                <p>Захиалгын өмнөх хүсэлтүүд</p>
              </div>
            </div>
            <div className="preorder-filters">
              <input
                aria-label="Урьдчилсан захиалга хайх"
                value={preorderSearch}
                onChange={(e) => setPreorderSearch(e.target.value)}
                placeholder="Нэр, утас, улсын дугаар..."
              />
              <select
                aria-label="Төлөвөөр шүүх"
                value={preorderStatusFilter}
                onChange={(e) =>
                  setPreorderStatusFilter(e.target.value as PreorderStatus | "")
                }
              >
                <option value="">Бүх төлөв</option>
                <option value="new">Шинэ</option>
                <option value="contacted">Холбогдсон</option>
                <option value="converted">Үндсэн захиалга болсон</option>
                <option value="cancelled">Цуцлагдсан</option>
              </select>
              <select
                aria-label="Эх сурвалжаар шүүх"
                value={preorderSourceFilter}
                onChange={(e) => setPreorderSourceFilter(e.target.value)}
              >
                <option value="">Бүх эх сурвалж</option>
                <option value="facebook">Facebook</option>
                <option value="website">Website</option>
                <option value="manual">Гараар</option>
              </select>
            </div>
            {preOrders.length === 0 ? (
              <div className="preorder-empty">
                <strong>Урьдчилсан захиалга алга</strong>
                <button className="primary" onClick={() => setPreorderModalOpen(true)}>
                  ＋ Урьдчилсан захиалга
                </button>
              </div>
            ) : visiblePreorders.length === 0 ? (
              <div className="empty">Таны хайлттай тохирох захиалга алга.</div>
            ) : (
              <div className="preorder-table-wrap">
                <table className="preorder-table">
                  <thead>
                    <tr>
                      <th>Үйлчлүүлэгч</th>
                      <th>Автомашин</th>
                      <th>Холбоо барих</th>
                      <th>Эх сурвалж</th>
                      <th>Огноо</th>
                      <th>Төлөв</th>
                      <th>Үйлдэл</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePreorders.map((item) => {
                      const converted = item.status === "converted" || item.convertedBookingId;
                      return (
                        <tr key={item.id}>
                          <td data-label="Үйлчлүүлэгч"><b>{item.customer}</b></td>
                          <td data-label="Автомашин"><b>{item.vehicle}</b><small>{item.plate || "Улсын дугааргүй"}</small><input className="year-inline" aria-label={`${item.customer} Үйлдвэрлэсэн он`} required maxLength={4} type="number" inputMode="numeric" min="1950" max={new Date().getFullYear() + 1} defaultValue={item.manufactureYear || ""} placeholder="Үйлдвэрлэсэн он" onBlur={(e) => { if (e.target.value !== String(item.manufactureYear || "")) updatePreorderYear(item.id, e.target.value); }} /></td>
                          <td data-label="Холбоо барих"><b>{item.phone}</b></td>
                          <td data-label="Эх сурвалж"><span className={`source-badge source-${item.source}`}>{preorderSource(item.source)}</span></td>
                          <td data-label="Огноо"><span className="preorder-date">{preorderDate(item.createdAt)}</span></td>
                          <td data-label="Төлөв"><span className={`status-badge status-${item.status}`}>{preorderStatus(item.status)}</span></td>
                          <td data-label="Үйлдэл">
                            <div className="preorder-actions">
                              <select
                                className="status-menu"
                                aria-label={`${item.customer} төлөв`}
                                value={item.status}
                                onChange={(e) => updatePreorderStatus(item.id, e.target.value as PreorderStatus)}
                                disabled={Boolean(converted)}
                              >
                                <option value="new">Шинэ</option>
                                <option value="contacted">Холбогдсон</option>
                                <option value="converted">Үндсэн захиалга болсон</option>
                                <option value="cancelled">Цуцлагдсан</option>
                              </select>
                              {converted ? <span className="converted-state">Үндсэн захиалга болсон</span> : item.status === "new" || item.status === "contacted" ? <button className="primary preorder-convert" onClick={() => convertPreorder(item)}>Үндсэн захиалга болгох</button> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </section>
      {preorderModalOpen && (
        <div className="modal-backdrop" onMouseDown={() => setPreorderModalOpen(false)}>
          <form className="modal preorder-modal" onSubmit={createPreorder} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">ШИНЭ ХҮСЭЛТ</p><h2>Урьдчилсан захиалга</h2></div>
              <button type="button" className="modal-close" aria-label="Хаах" onClick={() => setPreorderModalOpen(false)}>×</button>
            </div>
            <p className="modal-copy">Харилцагчийн мэдээллийг бүртгээд дараа нь үндсэн захиалга болгон хөрвүүлнэ.</p>
            <div className="fields two">
              <Field label="Нэр"><input required value={preorderForm.customer} onChange={(e) => setPreorderForm({ ...preorderForm, customer: e.target.value })} /></Field>
              <Field label="Утас"><input required value={preorderForm.phone} onChange={(e) => setPreorderForm({ ...preorderForm, phone: e.target.value })} /></Field>
              <Field label="Автомашин"><input required value={preorderForm.vehicle} onChange={(e) => setPreorderForm({ ...preorderForm, vehicle: e.target.value })} /></Field>
              <Field label="Улсын дугаар"><input value={preorderForm.plate} onChange={(e) => setPreorderForm({ ...preorderForm, plate: e.target.value })} /></Field>
              <Field label="Үйлдвэрлэсэн он *"><input required maxLength={4} type="number" inputMode="numeric" min="1950" max={new Date().getFullYear() + 1} value={preorderForm.manufactureYear} onChange={(e) => setPreorderForm({ ...preorderForm, manufactureYear: e.target.value })} /></Field>
            </div>
            {preorderDuplicateCheck?.phoneMatch && <DuplicateNotice>⚠ Энэ утасны дугаараар өмнө бүртгэл байна.</DuplicateNotice>}
            {preorderDuplicateCheck?.plateHistory && <DuplicateNotice>⚠ Энэ автомашин өмнө бүртгэгдсэн байна.<small>{preorderDuplicateCheck.plateHistory.vehicle} · {preorderDuplicateCheck.plateHistory.bookingNo}</small></DuplicateNotice>}
            <Field label="Нэмэлт мэдээлэл"><textarea rows={3} value={preorderForm.note} onChange={(e) => setPreorderForm({ ...preorderForm, note: e.target.value })} /></Field>
            <div className="form-actions"><button type="button" className="cancel" onClick={() => setPreorderModalOpen(false)}>Цуцлах</button><button className="primary" type="submit">Урьдчилсан захиалга бүртгэх</button></div>
          </form>
        </div>
      )}
      {editing && (
        <EditModal
          booking={editing}
          onClose={() => setEditing(null)}
          onSave={update}
          saving={updatingBookingId === editing.id}
        />
      )}
    </main>
  );
}

function BootScreen() {
  return (
    <main className="boot-screen">
      <div className="brand-mark">G</div>
      <strong>Грийн Энжин</strong>
      <span>Системийг ачаалж байна...</span>
      <i className="loading-spinner" aria-hidden="true" />
    </main>
  );
}

function AppLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="boot-screen">
      <div className="brand-mark">G</div>
      <strong>Грийн Энжин</strong>
      <span>Мэдээлэл ачаалж чадсангүй. Дахин оролдоно уу.</span>
      <button className="primary" onClick={onRetry}>Дахин оролдох</button>
    </main>
  );
}

function UserBlock({ user, buildLabel }: { user: { name: string; email: string; role: Role } | null; buildLabel?: string }) {
  const displayName = user?.name && !user.name.includes("@") ? user.name : user?.email?.split("@")[0].replace(/[._-]+/g, " ");
  return (
    <div className="operator">
      <small className="operator-label">НЭВТЭРСЭН ХЭРЭГЛЭГЧ</small>
      <div className="operator-head">
        <div className="avatar">{displayName?.[0]?.toUpperCase()}</div>
        <div className="operator-meta">
          <b>{displayName}</b>
          <small>{user ? roleLabel(user.role) : ""}</small>
        </div>
      </div>
      {buildLabel && <small className="build-meta">{buildLabel}</small>}
    </div>
  );
}

function Nav({
  children,
  i,
  a,
  on,
}: {
  children: React.ReactNode;
  i: IconName;
  a: boolean;
  on: () => void;
}) {
  return (
    <button className={a ? "active" : ""} onClick={on}>
      <span><Icon name={i} /></span>
      {children}
    </button>
  );
}
type IconName = "dashboard" | "plus" | "preorder" | "calendar" | "chart" | "settings" | "history";
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    preorder: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    calendar: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M7 3v3M17 3v3M3 9h18" /></>,
    chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /></>,
    settings: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.4 15 .1.1a2 2 0 0 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.2a2 2 0 0 1-4 0v-.2a2 2 0 0 0-3.4-1.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A2 2 0 0 0 3.6 12a2 2 0 0 0-.6-1.4l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A2 2 0 0 0 9.2 6.4h.2a2 2 0 0 0 0-4 2 2 0 0 1 4 0v.2a2 2 0 0 0 1.4 3.4h.1a2 2 0 0 0 1.4-.6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a2 2 0 0 0 1.4 3.4h.2a2 2 0 0 1 0 4h-.2a2 2 0 0 0-1.1.4Z" /></>,
    history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5" /><path d="M4 4v4.5h4.5M12 8v4l2.5 1.5" /></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
function Stat({ l, v, n, t }: { l: string; v: string; n: string; t: string }) {
  return (
    <article className={`stat ${t}`}>
      <div className="stat-icon">●</div>
      <p>{l}</p>
      <strong>{v}</strong>
      <small>{n}</small>
    </article>
  );
}
function Form({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="form-section">
      <div className="section-number">{n}</div>
      <div className="section-body">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
function DuplicateNotice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <div className={`duplicate-notice${error ? " error" : ""}`}>{children}</div>;
}
const auditActionLabels: Record<string, string> = {
  "booking.created": "Захиалга үүсгэсэн",
  "booking.updated": "Захиалга зассан",
  "booking.rescheduled": "Хуваарь өөрчилсөн",
  "booking.payment_updated": "Төлбөр шинэчилсэн",
  "booking.cancelled": "Захиалга цуцалсан",
  "booking.deleted": "Захиалга устгасан",
  "preorder.created": "Урьдчилсан захиалга үүсгэсэн",
  "preorder.updated": "Урьдчилсан захиалга зассан",
  "preorder.converted": "Үндсэн захиалга болгосон",
  "preorder.cancelled": "Урьдчилсан захиалга цуцалсан",
  "product.created": "Бүтээгдэхүүн үүсгэсэн",
  "product.updated": "Бүтээгдэхүүн зассан",
  "product.disabled": "Бүтээгдэхүүн идэвхгүй болгосон",
  "product.deleted": "Бүтээгдэхүүн устгасан",
  "user.created": "Хэрэглэгч үүсгэсэн",
  "user.updated": "Хэрэглэгч зассан",
  "user.role_changed": "Хэрэглэгчийн эрх өөрчилсөн",
  "user.activated": "Хэрэглэгч идэвхжүүлсэн",
  "user.deactivated": "Хэрэглэгч идэвхгүй болгосон",
};
const auditTypeLabels: Record<string, string> = { booking: "Захиалга", preorder: "Урьдчилсан захиалга", product: "Бүтээгдэхүүн", user: "Хэрэглэгч" };
function auditValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Хоосон";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
const auditFieldLabels: Record<string, string> = {
  booking_no: "Захиалгын дугаар",
  customer: "Үйлчлүүлэгч",
  phone: "Утас",
  plate: "Улсын дугаар",
  vehicle: "Автомашин",
  product_name: "Бүтээгдэхүүн",
  branch: "Салбар",
  booking_date: "Өдөр",
  booking_time: "Цаг",
  bookingDate: "Өдөр",
  bookingTime: "Цаг",
  total_price: "Нийт үнэ",
  totalPrice: "Нийт үнэ",
  advance: "Урьдчилгаа",
  final_paid: "Эцсийн төлбөр",
  finalPaid: "Эцсийн төлбөр",
  status: "Төлөв",
  manufacture_year: "Үйлдвэрлэсэн он",
  manufactureYear: "Үйлдвэрлэсэн он",
  advanceType: "Урьдчилгааны төрөл",
  advanceNote: "Урьдчилгааны тэмдэглэл",
};
const auditMoneyFields = new Set(["total_price", "totalPrice", "advance", "final_paid", "finalPaid"]);
function isAuditChange(value: unknown): value is { from?: unknown; to?: unknown } {
  return typeof value === "object" && value !== null && ("from" in value || "to" in value);
}
function auditDate(value: unknown) {
  if (typeof value !== "string") return auditValue(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : value;
}
function auditDisplayValue(key: string, value: unknown) {
  if ((key === "manufacture_year" || key === "manufactureYear") && (value === null || value === undefined || value === "")) return "Тодорхойгүй";
  if (key === "booking_date" || key === "bookingDate") return auditDate(value);
  if (auditMoneyFields.has(key) && typeof value === "number") return `${money.format(value)}₮`;
  return auditValue(value);
}
function auditChange(details: Record<string, unknown>, key: string) {
  const value = details[key];
  return isAuditChange(value) ? value : undefined;
}
function auditSchedule(details: Record<string, unknown>) {
  const date = details.booking_date ?? details.bookingDate;
  const time = details.booking_time ?? details.bookingTime;
  return `${auditDate(date)}${time ? ` ${auditValue(time)}` : ""}`;
}
function auditSummary(log: AuditLog) {
  const details = log.details || {};
  if (!Object.keys(details).length) return "";
  if (log.action === "booking.deleted") {
    return `${auditValue(details.customer || details.booking_no)} · ${auditValue(details.plate)} · ${auditValue(details.vehicle)} · ${auditValue(details.branch)} · ${auditSchedule(details)}`;
  }
  if (log.action === "booking.rescheduled") {
    const branch = auditChange(details, "branch");
    const date = auditChange(details, "booking_date") || auditChange(details, "bookingDate");
    const fromBranch = branch ? auditValue(branch.from) : auditValue(details.branch);
    const toBranch = branch ? auditValue(branch.to) : fromBranch;
    const fromDate = date ? auditDate(date.from) : auditDate(details.booking_date ?? details.bookingDate);
    const toDate = date ? auditDate(date.to) : fromDate;
    return `${fromBranch} → ${toBranch} · ${fromDate} → ${toDate}`;
  }
  if (log.action === "booking.payment_updated") {
    const paymentKey = auditChange(details, "advance") ? "advance" : auditChange(details, "finalPaid") ? "finalPaid" : "final_paid";
    const payment = auditChange(details, paymentKey);
    const paymentLabel = paymentKey === "advance" ? "Урьдчилгаа" : "Эцсийн төлбөр";
    return payment ? `${paymentLabel}: ${auditDisplayValue(paymentKey, payment.from)} → ${auditDisplayValue(paymentKey, payment.to)}` : "";
  }
  return Object.entries(details)
    .filter(([, value]) => isAuditChange(value))
    .slice(0, 2)
    .map(([key, value]) => {
      const change = isAuditChange(value) ? value : undefined;
      return `${auditFieldLabels[key] || key}: ${auditDisplayValue(key, change?.to ?? change?.from)}`;
    })
    .join(" · ");
}
function auditDetailValue(details: Record<string, unknown>, key: string) {
  const value = details[key];
  if (isAuditChange(value)) return value.to ?? value.from;
  return value;
}
function auditObject(log: AuditLog) {
  const details = log.details || {};
  if (log.entityType === "booking") {
    const plate = auditDetailValue(details, "plate") || log.displayPlate;
    const bookingNo = auditDetailValue(details, "booking_no") ?? auditDetailValue(details, "bookingNo") ?? log.entityRef;
    return { primary: auditValue(plate || bookingNo || (log.entityId ? `#${log.entityId}` : "-")), secondary: plate ? auditValue(bookingNo) : undefined };
  }
  if (log.entityType === "preorder") return { primary: auditValue(auditDetailValue(details, "plate") || log.entityRef || "-") };
  if (log.entityType === "product") return { primary: auditValue(auditDetailValue(details, "name") || auditDetailValue(details, "product_name") || log.entityRef || "-") };
  if (log.entityType === "user") return { primary: auditValue(auditDetailValue(details, "email") || log.entityRef || "-") };
  return { primary: log.entityRef || (log.entityId ? `#${log.entityId}` : "-") };
}
function AuditLogView() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", actor: "", action: "", entityType: "", search: "" });
  const [expanded, setExpanded] = useState<number | null>(null);
  useEffect(() => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as string[][]);
    fetch(`/api/audit-logs?${query}`)
      .then((response) => response.ok ? response.json() : { logs: [] })
      .then((data: { logs?: AuditLog[] }) => setLogs(data.logs || []));
  }, [filters]);
  const updateFilter = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  return (
    <section className="panel">
      <div className="panel-head audit-filters">
        <input type="date" aria-label="Огноо эхлэх" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} />
        <input type="date" aria-label="Огноо дуусах" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} />
        <input placeholder="Хэрэглэгч" value={filters.actor} onChange={(e) => updateFilter("actor", e.target.value)} />
        <select value={filters.action} onChange={(e) => updateFilter("action", e.target.value)}>
          <option value="">Бүх үйлдэл</option>
          {Object.entries(auditActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={filters.entityType} onChange={(e) => updateFilter("entityType", e.target.value)}>
          <option value="">Бүх төрөл</option><option value="booking">Захиалга</option><option value="preorder">Урьдчилсан захиалга</option><option value="product">Бүтээгдэхүүн</option><option value="user">Хэрэглэгч</option>
        </select>
        <input placeholder="Дугаар, хэрэглэгч хайх" value={filters.search} onChange={(e) => updateFilter("search", e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ОГНОО</th><th>ХЭРЭГЛЭГЧ</th><th>ҮЙЛДЭЛ</th><th>ТӨРӨЛ</th><th>ОБЪЕКТ</th><th>ӨӨРЧЛӨЛТ</th></tr></thead>
          <tbody>{logs.map((log) => {
            const changeEntries = Object.entries(log.details || {});
            const meaningfulEntries = changeEntries.filter(([, value]) => value !== undefined && value !== null && value !== "");
            const summary = auditSummary(log);
            const object = auditObject(log);
            return <tr key={log.id}>
              <td data-label="Огноо">{new Intl.DateTimeFormat("mn-MN", { dateStyle: "short", timeStyle: "short" }).format(new Date(log.createdAt))}</td>
              <td data-label="Хэрэглэгч"><b>{log.actorEmail}</b><small>{log.actorRole || ""}</small></td>
              <td data-label="Үйлдэл"><span className="status-badge">{auditActionLabels[log.action] || log.action}</span></td>
              <td data-label="Төрөл">{auditTypeLabels[log.entityType] || log.entityType}</td>
              <td data-label="Объект"><b className="audit-object-primary">{object.primary}</b>{object.secondary && <small className="audit-object-secondary">{object.secondary}</small>}</td>
              <td data-label="Өөрчлөлт">{meaningfulEntries.length ? <><span className="audit-summary">{summary || "Нэмэлт мэдээлэлтэй"}</span><button className="soft" onClick={() => setExpanded(expanded === log.id ? null : log.id)}>{expanded === log.id ? "Хураах" : "Дэлгэрүүлж харах"}</button>{expanded === log.id && <div className="audit-details">{changeEntries.map(([key, value]) => { const change = isAuditChange(value) ? value : undefined; return <div key={key}><b>{auditFieldLabels[key] || key}</b><span>{change?.from !== undefined ? `${auditDisplayValue(key, change.from)} → ` : ""}{change?.to !== undefined ? auditDisplayValue(key, change.to) : auditDisplayValue(key, value)}</span></div>; })}</div>}</> : <span className="audit-empty">Нэмэлт мэдээлэлгүй</span>}</td>
            </tr>;
          })}</tbody>
        </table>
        {!logs.length && <div className="empty">Бүртгэл олдсонгүй.</div>}
      </div>
    </section>
  );
}
function BookingTable({
  rows,
  onEdit,
  onComplete,
  loading,
  role = "admin",
}: {
  rows: Booking[];
  onEdit: (b: Booking) => void;
  onComplete: (b: Booking) => void;
  loading: boolean;
  role?: Role;
}) {
  const mechanic =
      role === "mechanic" ||
      (rows.length > 0 && rows[0].totalPrice === undefined),
    editable = !mechanic;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ЗАХИАЛГА</th>
            <th>АВТОМАШИН</th>
            <th>ХУВААРЬ</th>
            <th>ТӨЛБӨР</th>
            {editable && <th>ҮЙЛДЭЛ</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td data-label="Захиалга">
                <b>{b.bookingNo}</b>
                <b>{b.customer}</b>
                <small>
                  #{b.id} · {b.phone}
                </small>
              </td>
              <td data-label="Автомашин">
                <b>{b.plate}</b>
                <small>{b.vehicle} · {b.manufactureYear || "Тодорхойгүй"}</small>
              </td>
              <td data-label="Хуваарь">
                <b>{b.branch}</b>
                <small>
                  {b.date} · {b.time}
                </small>
              </td>
              <td data-label="Төлбөр">
                {mechanic ? (
                  <>
                    <b className={b.advancePaid ? "paid" : "unpaid"}>
                      Урьдчилгаа {b.advancePaid ? "төлсөн" : "төлөөгүй"}
                    </b>
                    <small>
                      Үлдэгдэл {b.balancePaid ? "төлсөн" : "төлөөгүй"}
                    </small>
                  </>
                ) : (
                  <>
                    <b>{money.format(b.totalPrice || 0)}₮</b>
                    <small>
                      Урьдчилгаа {money.format(b.advance || 0)}₮ · Үлдэгдэл{" "}
                      {money.format(balance(b))}₮
                    </small>
                  </>
                )}
              </td>
              {editable && (
                <td data-label="Үйлдэл">
                  <div className="row-actions">
                    <button onClick={() => onEdit(b)}>Хуваарь</button>
                    {balance(b) > 0 && (
                      <button className="pay" onClick={() => onComplete(b)}>
                        Үлдэгдэл авах
                      </button>
                    )}
                    {balance(b) === 0 && (
                      <span className="paid">Төлөгдсөн</span>
                    )}
                    <button
                      className="delete"
                      onClick={async () => {
                        if (confirm(`Захиалга #${b.id}-г устгах уу?`)) {
                          await fetch(`/api/bookings/${b.id}`, {
                            method: "DELETE",
                          });
                          location.reload();
                        }
                      }}
                    >
                      Устгах
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {loading && <div className="empty">Бүртгэл ачаалж байна…</div>}
      {!loading && rows.length === 0 && (
        <div className="empty">Одоогоор захиалга алга.</div>
      )}
    </div>
  );
}
function EditModal({
  booking,
  onClose,
  onSave,
  saving,
}: {
  booking: Booking;
  onClose: () => void;
  onSave: (id: number, p: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [branch, setBranch] = useState(booking.branch),
    [date, setDate] = useState(booking.date),
    [time, setTime] = useState(booking.time),
    [manufactureYear, setManufactureYear] = useState(booking.manufactureYear ? String(booking.manufactureYear) : "");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <p className="eyebrow">{booking.bookingNo}</p>
        <h2>Хуваарь өөрчлөх</h2>
        <p>
          {booking.plate} · {booking.customer}
        </p>
        <div className="fields one">
          <Field label="Салбар">
            <select value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
          <Field label="Шинэ өдөр">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Шинэ цаг">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
          <Field label="Үйлдвэрлэсэн он">
            <input type="number" inputMode="numeric" min="1950" max={new Date().getFullYear() + 1} value={manufactureYear} onChange={(e) => setManufactureYear(e.target.value)} />
          </Field>
        </div>
        <div className="shift-buttons">
          <button onClick={() => setDate(addDays(date, -1))}>
            ← 1 өдөр урагш
          </button>
          <button onClick={() => setDate(addDays(date, 1))}>
            1 өдөр хойш →
          </button>
        </div>
        <div className="form-actions">
          <button className="cancel" onClick={onClose}>
            Цуцлах
          </button>
          <button
            className="primary"
            disabled={saving}
            onClick={() => onSave(booking.id, { branch, date, time, manufactureYear })}
          >
            {saving ? "Хадгалж байна..." : "Хадгалах"}
          </button>
        </div>
      </div>
    </div>
  );
}
