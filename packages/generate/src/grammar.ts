/**
 * The Loop grammar reference handed to the LLM so it can turn a natural-language
 * description into a valid .loop flow. Kept tight — vocabulary + shape + two
 * worked examples. The generator validates the output by actually parsing it.
 */
export const GRAMMAR = `You write Loop (.loop) flows — a small natural-language DSL for AI coding loops.

VOCABULARY (use only these):
  loop "<name>":            a self-correcting loop
  pipeline "<name>":        a sequence of stages
  stage "<name>":           one stage of a pipeline (contains a loop body)
  goal: <text>              what "done" means
  done when the test "<id>" passes      | done when "<shell cmd>" passes | done when "<shell cmd>" finds nothing
  look at: <fileA>, <fileB>, and the last failure
  allow edits automatically, but ask me before <migrations or pushes>
  each cycle: plan, then act, then observe   (any subset, in order)
  also: <pass1>, <pass2>          extra finishing passes after the goal is met
  when it passes and the goal is met: stop
  when it fails: reflect on <focus>, then plan again
  when blocked: ask a human
  after <N> tries: stop and warn "<message>"
  a human approves the plan first
  a human reviews before stopping
  a human approves before <action>     (a stage gate)
  plan from the archon project "<name>"

RULES:
- Indentation matters: loop/pipeline at column 0; their body indented; stage bodies indented under the stage.
- A loop needs a goal. A pipeline needs at least one stage.
- An epic maps to a pipeline; each story maps to a stage.
- Scope each loop to its files with look at: so the agent follows the existing architecture.
- Put human gates on risky work (payments, migrations, deploys).
- Output ONLY the .loop content. No prose, no markdown code fences.

EXAMPLE — a single loop:
loop "fix flaky test":
  goal: the checkout tax test passes reliably
  done when the test "checkout.spec.ts::tax" passes
  look at: src/checkout/tax.ts, and the last failure
  allow edits automatically
  each cycle: plan, then act, then observe
  when it fails: reflect on why it flaked, then plan again
  after 6 tries: stop and warn "still flaky"

EXAMPLE — an epic with stories:
pipeline "epic: checkout v2":
  stage "story: cart totals":
    goal: cart shows correct totals with tax
    look at: src/cart/, src/tax/
    done when "pnpm test cart" passes
    each cycle: plan, then act, then observe
    when it fails: reflect, then plan again
  stage "story: checkout submit":
    goal: order submits and payment is captured
    a human approves before charging the card
    done when "pnpm test checkout" passes`;
