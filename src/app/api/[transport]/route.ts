import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { authenticateBearerToken } from "../../../gateway/auth";
import { db } from "../../../db/client";
import { getRequestIdentity, requestIdentityStorage } from "../../../gateway/request-context";
import {
  getAuditLog,
  getCustomer,
  getOrder,
  getTicket,
  listOrders,
  listPendingActions,
  searchTickets,
  whoami,
  withReadGuard,
} from "../../../gateway/tools/read";

const ticketIdSchema = z
  .string()
  .regex(/^T-\d{1,6}$/)
  .describe("Ticket ID, for example T-1001");
const customerIdSchema = z
  .string()
  .regex(/^C-\d{1,6}$/)
  .describe("Customer ID, for example C-204");
const orderIdSchema = z
  .string()
  .regex(/^O-\d{1,6}$/)
  .describe("Order ID, for example O-5003");

const handler = createMcpHandler((server) => {
  server.registerTool(
    "whoami",
    {
      title: "Who Am I",
      description: "Returns the connected role and available read actions.",
      inputSchema: z.object({}),
    },
    async () =>
      withReadGuard(db, getRequestIdentity(), "whoami", {}, () =>
        whoami(getRequestIdentity()),
      ),
  );

  server.registerTool(
    "search_tickets",
    {
      title: "Search Tickets",
      description: "Search ticket subjects and bodies.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(100),
        status: z.enum(["open", "closed"]).optional(),
        limit: z.number().int().min(1).max(20).default(20),
      }),
    },
    async (args) => {
      const identity = getRequestIdentity();
      return withReadGuard(db, identity, "search_tickets", args, () => {
        if (!identity) {
          throw new Error("Authentication required");
        }
        return searchTickets(db, identity, args.query, args.status, args.limit);
      });
    },
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Get Ticket",
      description: "Get one ticket while marking free text as untrusted.",
      inputSchema: z.object({ id: ticketIdSchema }),
    },
    async (args) => {
      const identity = getRequestIdentity();
      return withReadGuard(db, identity, "get_ticket", args, () => {
        if (!identity) throw new Error("Authentication required");
        return getTicket(db, identity, args.id);
      });
    },
  );

  server.registerTool(
    "get_customer",
    {
      title: "Get Customer",
      description: "Get one customer with role-aware PII masking.",
      inputSchema: z.object({ id: customerIdSchema }),
    },
    async (args) => {
      const identity = getRequestIdentity();
      return withReadGuard(db, identity, "get_customer", args, () => {
        if (!identity) throw new Error("Authentication required");
        return getCustomer(db, identity, args.id);
      });
    },
  );

  server.registerTool(
    "list_orders",
    {
      title: "List Orders",
      description: "List up to 20 orders for a customer.",
      inputSchema: z.object({
        customer_id: customerIdSchema,
        limit: z.number().int().min(1).max(20).default(20),
      }),
    },
    async (args) => {
      const identity = getRequestIdentity();
      return withReadGuard(db, identity, "list_orders", args, () => {
        if (!identity) throw new Error("Authentication required");
        return listOrders(db, identity, args.customer_id, args.limit);
      });
    },
  );

  server.registerTool(
    "get_order",
    {
      title: "Get Order",
      description: "Get one order by strict order ID.",
      inputSchema: z.object({ id: orderIdSchema }),
    },
    async (args) => {
      const identity = getRequestIdentity();
      return withReadGuard(db, identity, "get_order", args, () => {
        if (!identity) throw new Error("Authentication required");
        return getOrder(db, identity, args.id);
      });
    },
  );

  server.registerTool(
    "list_pending_actions",
    {
      title: "List Pending Actions",
      description: "List pending actions with role-aware visibility.",
      inputSchema: z.object({}),
    },
    async () => {
      const identity = getRequestIdentity();
      return withReadGuard(db, identity, "list_pending_actions", {}, () => {
        if (!identity) throw new Error("Authentication required");
        return listPendingActions(db, identity);
      });
    },
  );

  server.registerTool(
    "get_audit_log",
    {
      title: "Get Audit Log",
      description: "Get recent audit entries.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(50),
      }),
    },
    async (args) => {
      const identity = getRequestIdentity();
      return withReadGuard(db, identity, "get_audit_log", args, () => {
        if (!identity) throw new Error("Authentication required");
        return getAuditLog(db, identity, args.limit);
      });
    },
  );
});

async function withIdentity(
  request: Request,
): Promise<Response> {
  const credential =
    request.headers.get("x-mcp-remote-auth") ??
    request.headers.get("authorization");
  const identity = authenticateBearerToken(credential);
  return requestIdentityStorage.run(identity, () => handler(request));
}

export { withIdentity as GET, withIdentity as POST };
