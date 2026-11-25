import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { getWhoami } from "../../../gateway/whoami";

const handler = createMcpHandler((server) => {
  server.registerTool(
    "whoami",
    {
      title: "Who Am I",
      description: "Returns the static role available during the scaffold milestone.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(getWhoami()),
        },
      ],
    }),
  );
});

export { handler as GET, handler as POST };
