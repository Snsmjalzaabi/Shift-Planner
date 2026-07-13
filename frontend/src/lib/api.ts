export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
export const API_BASE = `${BACKEND_URL}/api`;

export type AuthUser = {
  id: string;
  email: string;
  display_name?: string | null;
  is_superuser: boolean;
  plan: "free" | "plus" | string;
  plan_source?: "free" | "ccad" | "paid" | string;
  created_at: string;
  plus_expires_at?: string | null;
};

export type Shift = {
  id: string;
  user_id: string;
  date: string;
  type: "day" | "night" | "on_call" | "off";
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  note?: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

export type ApiError = Error & { status?: number; code?: string };

async function request<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body?.detail) {
        if (typeof body.detail === "string") {
          detail = body.detail;
        } else if (typeof body.detail === "object") {
          detail = body.detail.message || JSON.stringify(body.detail);
          code = body.detail.code;
        }
      }
    } catch {
      // ignore
    }
    const err: ApiError = new Error(detail);
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return (await res.json()) as T;
}

export function isPlusRequired(e: unknown): boolean {
  const err = e as ApiError | null;
  return !!err && (err.status === 402 || err.code === "plus_required");
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string, display_name?: string) =>
    request<LoginResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name }),
    }),

  me: (token: string) => request<AuthUser>("/auth/me", { token }),

  branding: () =>
    request<{
      app_name: string;
      subtitle: string;
      created_by: string;
      created_by_url: string;
      creator_signature: string;
    }>("/branding"),

  listShifts: (token: string, month?: string, isDraft?: boolean) => {
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (isDraft !== undefined) params.set("is_draft", String(isDraft));
    const q = params.toString();
    return request<Shift[]>(`/shifts${q ? `?${q}` : ""}`, { token });
  },

  createShift: (
    token: string,
    body: {
      date: string;
      type: string;
      start_time?: string | null;
      end_time?: string | null;
      location?: string | null;
      note?: string | null;
      is_draft?: boolean;
    },
  ) =>
    request<Shift>("/shifts", {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),

  updateShift: (
    token: string,
    id: string,
    body: Partial<{
      type: string;
      start_time: string | null;
      end_time: string | null;
      location: string | null;
      note: string | null;
      is_draft: boolean;
    }>,
  ) =>
    request<Shift>(`/shifts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    }),

  deleteShift: (token: string, id: string) =>
    request<{ deleted: boolean }>(`/shifts/${id}`, {
      method: "DELETE",
      token,
    }),

  confirmShift: (token: string, id: string) =>
    request<Shift>(`/shifts/${id}/confirm`, {
      method: "POST",
      token,
    }),

  exportXlsx: (
    token: string,
    body: { month: string; include_confirmed?: boolean },
  ) =>
    request<{
      filename: string;
      content_type: string;
      base64: string;
      size_bytes: number;
      shift_count: number;
      created_by: string;
    }>("/export/xlsx", {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),

  exportEmail: (
    token: string,
    body: {
      month: string;
      include_confirmed?: boolean;
      email_to?: string;
      send?: boolean;
      attach_xlsx?: boolean;
    },
  ) =>
    request<{
      to: string;
      subject: string;
      body: string;
      html: string;
      shift_count: number;
      signature: string;
      delivered: boolean;
      provider: string | null;
      message_id: string | null;
      delivery_error: string | null;
      sendgrid_configured: boolean;
    }>("/export/email", {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),

  billingConfig: () =>
    request<{
      provider: string;
      test_mode: boolean;
      configured: boolean;
      currency: string;
      price_fils: number;
      price_display: string;
      plans: {
        id: string;
        name: string;
        price_display: string;
        badge_display: string;
        period: string;
        features: string[];
      }[];
    }>("/billing/config"),

  checkout: (
    token: string,
    body: { success_url?: string; cancel_url?: string } = {},
  ) =>
    request<{
      payment_intent_id: string;
      redirect_url: string;
      status: string;
      test_mode: boolean;
      price_display: string;
    }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),

  verifyCheckout: (token: string, payment_intent_id: string) =>
    request<{
      payment_intent_id: string;
      status: string;
      activated: boolean;
      plus_expires_at: string | null;
      user: AuthUser | null;
    }>("/billing/verify", {
      method: "POST",
      body: JSON.stringify({ payment_intent_id }),
      token,
    }),
};
