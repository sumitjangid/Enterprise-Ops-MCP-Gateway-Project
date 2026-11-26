"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";

import { db } from "../../db/client";
import {
  createDashboardSession,
  DASHBOARD_COOKIE_NAME,
  verifyDashboardSession,
} from "../../gateway/dashboard-session";
import { authenticateBearerToken } from "../../gateway/auth";
import { approveAction, rejectAction } from "../../gateway/tools/write";
import { withReadGuard } from "../../gateway/tools/read";
import type { ToolResult } from "../../gateway/tools/read";
import { logCall } from "../../gateway/audit";

const actionIdSchema = z
  .string()
  .max(38)
  .regex(/^A-[A-Za-z0-9-]{1,36}$/);
const reasonSchema = z.string().trim().min(1).max(500);

function resultHasError(result: ToolResult): boolean {
  const text = result.content[0]?.text;
  if (!text) {
    return true;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed !== "object" ||
      parsed === null ||
      "error" in parsed
    );
  } catch {
    return true;
  }
}

function finishDecision(result: ToolResult, success: "approved" | "rejected") {
  revalidatePath("/dashboard");
  redirect(`/dashboard?result=${resultHasError(result) ? "error" : success}`);
}

async function dashboardIdentity() {
  const cookieStore = await cookies();
  return verifyDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
}

export async function login(
  _state: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const parsed = z
    .object({
      token: z.string().trim().min(1).max(512),
    })
    .safeParse({ token: formData.get("token") });
  if (!parsed.success) {
    return { error: "A valid manager token is required." };
  }

  const identity = authenticateBearerToken(`Bearer ${parsed.data.token}`);
  if (!identity || identity.role !== "manager") {
    return { error: "Invalid manager credentials." };
  }
  const session = createDashboardSession(identity);
  if (!session) {
    return { error: "Dashboard session signing is not configured." };
  }

  const cookieStore = await cookies();
  cookieStore.set(DASHBOARD_COOKIE_NAME, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/dashboard",
    maxAge: 8 * 60 * 60,
  });
  revalidatePath("/dashboard");
  return {};
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete({
    name: DASHBOARD_COOKIE_NAME,
    path: "/dashboard",
  });
  revalidatePath("/dashboard");
}

export async function approveDashboardAction(actionId: string): Promise<void> {
  const identity = await dashboardIdentity();
  if (!identity) {
    redirect("/dashboard?result=error");
  }
  const parsed = actionIdSchema.safeParse(actionId);
  if (!parsed.success) {
    await logCall(db, {
      role: identity.role,
      tokenLabel: identity.tokenLabel,
      tool: "approve_action",
      args: { action_id: "[INVALID]" },
      outcome: "denied",
      reason: "Invalid action ID",
      resultSummary: "Dashboard call denied",
    });
    redirect("/dashboard?result=error");
  }
  const result = await withReadGuard(
    db,
    identity,
    "approve_action",
    { action_id: parsed.data },
    () => approveAction(db, identity, parsed.data),
  );
  finishDecision(result, "approved");
}

export async function rejectDashboardAction(
  actionId: string,
  formData: FormData,
): Promise<void> {
  const identity = await dashboardIdentity();
  if (!identity) {
    redirect("/dashboard?result=error");
  }
  const reason = String(formData.get("reason") ?? "");
  const idResult = actionIdSchema.safeParse(actionId);
  const reasonResult = reasonSchema.safeParse(reason);
  if (!idResult.success || !reasonResult.success) {
    await logCall(db, {
      role: identity.role,
      tokenLabel: identity.tokenLabel,
      tool: "reject_action",
      args: {
        action_id: idResult.success ? idResult.data : "[INVALID]",
        reason: "[USER-PROVIDED TEXT REDACTED]",
      },
      outcome: "denied",
      reason: "Invalid dashboard rejection input",
      resultSummary: "Dashboard call denied",
    });
    redirect("/dashboard?result=error");
  }
  const result = await withReadGuard(
    db,
    identity,
    "reject_action",
    { action_id: idResult.data, reason: reasonResult.data },
    () => rejectAction(db, identity, idResult.data, reasonResult.data),
  );
  finishDecision(result, "rejected");
}
