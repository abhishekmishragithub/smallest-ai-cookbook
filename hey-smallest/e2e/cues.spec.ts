import { expect, test } from "@playwright/test";

test("mock mode walks call-flow cues in order", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ask the docs" })).toBeVisible();
  await page.getByRole("button", { name: "How does a voice agent call flow end to end?" }).click();
  const steps = page.locator(".hey-steps li");
  await expect(steps).toHaveCount(7, { timeout: 15_000 });
  await expect(steps.nth(0)).toHaveAttribute("data-step", /active|done/);
  const seen: string[] = [];
  await expect
    .poll(
      async () => {
        const ids = await steps.evaluateAll((nodes) =>
          nodes
            .filter((node) => node.getAttribute("data-step") === "done" || node.getAttribute("data-step") === "active")
            .map((node) => node.getAttribute("data-cue-id") ?? ""),
        );
        if (ids.length > seen.length) seen.splice(0, seen.length, ...ids);
        return ids.length;
      },
      { timeout: 30_000 },
    )
    .toBe(7);
  expect(seen[0]).toBe("call-server");
  expect(seen.at(-1)).toBe("call-transcript");
});
