import { describe, expect, it } from "vitest";

import { createSeedData } from "../src/db/seed-data";

describe("synthetic seed data", () => {
  it("creates the required record counts", () => {
    const data = createSeedData();

    expect(data.customers).toHaveLength(15);
    expect(data.orders).toHaveLength(40);
    expect(data.tickets).toHaveLength(25);
  });

  it("includes the planned security and ambiguity scenarios", () => {
    const data = createSeedData();
    const injectionTicket = data.tickets.find((ticket) => ticket.id === "T-1007");
    const exfiltrationCustomer = data.customers.find(
      (customer) => customer.id === "C-204",
    );
    const highValueOrder = data.orders.find((order) => order.id === "O-5003");
    const smithCustomers = data.customers.filter((customer) =>
      customer.name.endsWith("Smith"),
    );

    expect(injectionTicket?.body).toContain("Ignore previous instructions");
    expect(exfiltrationCustomer?.notes).toContain("every customer's email");
    expect(Number(highValueOrder?.total)).toBeGreaterThan(500);
    expect(smithCustomers).toHaveLength(2);
    expect(data.expiredAction.status).toBe("expired");
  });

  it("is deterministic", () => {
    expect(createSeedData()).toEqual(createSeedData());
  });
});
