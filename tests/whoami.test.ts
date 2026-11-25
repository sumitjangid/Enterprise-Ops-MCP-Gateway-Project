import { describe, expect, it } from "vitest";

import { getWhoami } from "../src/gateway/whoami";

describe("getWhoami", () => {
  it("returns the scaffold role and whoami action", () => {
    expect(getWhoami()).toEqual({
      role: "unconfigured",
      allowedActions: ["whoami"],
    });
  });
});
