const RAW_API_BASE =
  process.env.EXPO_PUBLIC_API_URL ||
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  "http://localhost:8001/api";

const API_BASE = RAW_API_BASE.endsWith("/api")
  ? RAW_API_BASE
  : `${RAW_API_BASE.replace(/\/$/, "")}/api`;

type RequestInitWithToken = RequestInit & {
  token?: string | null;
};

export type AuthUser = {
  id: string;
  email: string;
  display_name?: string | null;
  is_superuser: boolean;
  plan: "free" | "plus" | string;
  account_type?: "pending" | "ccad_free" | "paid_subscription" | "expired" | string;
  email_verified?: boolean;
  subscription_active?: boolean;
  access_active?: boolean;
  created_at: string;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

export type ShiftType = {
  code: string;
  label: string;
  category: string;
  start_time: string;
  end_time: string;
  color: string;
};

export type Shift = {
  id: string;
  user_id: string;
  date: string;
  type: string;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  note?: string | null;
  is_draft: boolean;
  source?: string;
  created_at: string;
  updated_at: string;
};

export type PlannerDraft = {
  id: string;
  user_id: string;
  plan_name: string;
  start_date: string;
  end_date: string;
  status: string;
  notes?: string | null;
  calendar_affected: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type PlannerDay = {
  id: string;
  planner_draft_id: string;
  date: string;
  current_confirmed_shift: string;
  proposed_plan: string;
  action_needed: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type PlannerDraftDetails = {
  draft: PlannerDraft;
  days: PlannerDay[];
};

export type FamilyMember = {
  id: string;
  user_id: string;
  name: string;
  email?: string | null;
  privacy_level: number;
  availability: string;
  status: string;
  created_at: string;
  updated_at: string;
};

async function request<T>(path: string, init: RequestInitWithToken = {}): Promise<T> {
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
    try {
      const body = await res.json();
      if (body?.detail) {
        detail =
          typeof body.detail === "string"
            ? body.detail
            : JSON.stringify(body.detail);
      }
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return (await res.json()) as T;
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

  verifyCcad: (token: string, email: string, code: string) =>
    request<AuthUser>("/auth/verify-ccad", {
      method: "POST",
      body: JSON.stringify({ email, code }),
      token,
    }),

  mockSubscribe: (token: string) =>
    request<AuthUser>("/auth/mock-subscribe", {
      method: "POST",
      body: JSON.stringify({ activate: true }),
      token,
    }),

  branding: () =>
    request<{
      app_name: string;
      subtitle: string;
      created_by: string;
      created_by_url: string;
      creator_signature: string;
    }>("/branding"),

  listShiftTypes: () => request<ShiftType[]>("/shift-types"),

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
      source?: string;
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
      source: string;
    }>,
  ) =>
    request<Shift>(`/shifts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    }),

  deleteShift: (token: string, id: string) =>
    request<{ deleted: boolean; id: string }>(`/shifts/${id}`, {
      method: "DELETE",
      token,
    }),

  confirmShift: (token: string, id: string) =>
    request<Shift>(`/shifts/${id}/confirm`, {
      method: "POST",
      token,
    }),

  createPlannerDraft: (
    token: string,
    body: { plan_name: string; start_date: string; notes?: string | null },
  ) =>
    request<PlannerDraft>("/planner/drafts", {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),

  listPlannerDrafts: (token: string) =>
    request<PlannerDraft[]>("/planner/drafts", { token }),

  getPlannerDraft: (token: string, draftId: string) =>
    request<PlannerDraftDetails>(`/planner/drafts/${draftId}`, { token }),

  updatePlannerDay: (
    token: string,
    dayId: string,
    body: Partial<{
      proposed_plan: string;
      action_needed: string;
      notes: string;
    }>,
  ) =>
    request<PlannerDay>(`/planner/days/${dayId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    }),

  exportPlannerXlsx: (token: string, draftId: string) =>
    request<{
      filename: string;
      content_type: string;
      base64: string;
      size_bytes: number;
      created_by: string;
    }>(`/planner/drafts/${draftId}/export-xlsx`, {
      method: "POST",
      token,
    }),

  emailPlannerDraft: (
    token: string,
    draftId: string,
    body: { email_to?: string },
  ) =>
    request<{
      to: string;
      subject: string;
      body: string;
      status: string;
    }>(`/planner/drafts/${draftId}/email`, {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),

  listFamilyMembers: (token: string) =>
    request<FamilyMember[]>("/family-members", { token }),

  createFamilyMember: (
    token: string,
    body: {
      name: string;
      email?: string | null;
      privacy_level: number;
      availability: string;
    },
  ) =>
    request<FamilyMember>("/family-members", {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),

  deleteFamilyMember: (token: string, id: string) =>
    request<{ deleted: boolean; id: string }>(`/family-members/${id}`, {
      method: "DELETE",
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
};
