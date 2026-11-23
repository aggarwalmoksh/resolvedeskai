import assert from "node:assert/strict";
import { classifyComplaint } from "../src/ai/azureTriage.js";

const examples = [
  {
    text: "Mera order abhi tak nahi aaya. Event 30 minutes mein start hai.",
    category: "delivery",
    priority: "high",
  },
  {
    text: "Unauthorized charges are still going through on my card.",
    category: "billing",
    priority: "urgent",
  },
];

try {
  for (const example of examples) {
    const result = await classifyComplaint(example.text);
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.category, example.category);
    assert.equal(result.priority, example.priority);
  }
} catch (error) {
  console.error(`Azure smoke test failed: ${error.message}`);
  if (error.cause?.code) console.error(`Network error: ${error.cause.code}`);
  process.exitCode = 1;
}
