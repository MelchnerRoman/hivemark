import { repo } from "../db.js";
import type { AnthropicToolDef } from "./manager.js";

/**
 * Linear's real MCP server is a remote, OAuth-authenticated endpoint
 * (mcp.linear.app) — not a local stdio process. Rather than implement the
 * full OAuth device flow for this pass, we call Linear's GraphQL API
 * directly with a personal API key. Real network calls, simplified auth.
 */
export const LINEAR_TOOL_DEFS: AnthropicToolDef[] = [
  {
    name: "search_issues",
    description: "Search Linear issues by text.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "create_issue",
    description: "Create a Linear issue in a given team.",
    input_schema: {
      type: "object",
      properties: {
        teamId: { type: "string", description: "Linear team ID" },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["teamId", "title"],
    },
  },
];

async function linearGraphQL(apiKey: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json()) as any;
}

export async function callLinearTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ text: string; isError: boolean }> {
  const apiKey = repo.getConnectionValue("linear");
  if (!apiKey) return { text: "Linear is not connected.", isError: true };

  try {
    if (name === "search_issues") {
      const data = await linearGraphQL(
        apiKey,
        `query($term: String!) { issueSearch(query: $term, first: 10) { nodes { identifier title state { name } } } }`,
        { term: String(args.query ?? "") }
      );
      if (data.errors) return { text: `Linear API error: ${data.errors[0]?.message}`, isError: true };
      const nodes = data.data?.issueSearch?.nodes ?? [];
      return {
        text: nodes.map((n: any) => `${n.identifier} [${n.state?.name}] ${n.title}`).join("\n") || "No matches.",
        isError: false,
      };
    }
    if (name === "create_issue") {
      const data = await linearGraphQL(
        apiKey,
        `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }`,
        { input: { teamId: args.teamId, title: args.title, description: args.description ?? "" } }
      );
      if (data.errors) return { text: `Linear API error: ${data.errors[0]?.message}`, isError: true };
      const issue = data.data?.issueCreate?.issue;
      return { text: issue ? `Created ${issue.identifier}: ${issue.url}` : "Creation failed.", isError: !issue };
    }
    return { text: `Unknown Linear tool: ${name}`, isError: true };
  } catch (err) {
    return { text: `Linear request failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
