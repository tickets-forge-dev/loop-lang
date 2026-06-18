# I Was the For-Loop

*I thought I missed writing code. Turns out I missed deciding — and that part you can get back.*

---

I don't miss writing code. Not really.

I missed *something*, for months, and I kept calling it "writing code" because that was the nearest word. Saying otherwise sounds like the setup to a tool pitch, so let me just show you the conclusion I backed into — I resisted it for a long time.

## What I thought I missed

The typing.

Specifically, the way the act of typing finishes the thought. You have the shape of a function half-formed in your head, you start writing it, and the writing *is* the thinking. The code teaches you what you meant. You rename one variable and the whole design clicks into a better shape you couldn't see from the outside. Hours go like that.

That's what I reached for when I felt the absence. And here's the part that took me too long to admit: reaching for it was a dead end. The model writes the code now, it writes it well, and when it doesn't it's usually because I was vague, not because it couldn't type. I tried the obvious cure — turn the AI off for the hard parts, do those by hand. I lasted about a week. It felt good, it was slower, and it produced nothing the machine wouldn't have. It felt like nostalgia wearing the costume of principle.

So the typing wasn't it. I'd confused the instrument for the music.

## What actually went missing

Every coding task is five decisions. What *done* means. What the work is allowed to touch. What actions it can take on its own. How you'll know it actually worked. And when to stop.

I used to make all five with my hands on the keyboard, without noticing — they were dissolved into the act of building. When the model took over the building, those five decisions didn't get promoted to me. They got *buried*. Smeared across a long prompt, a few "actually, also—" follow-ups, and a lot of me squinting at output going "no, not like that." I was still making every decision. I just couldn't see them anymore, so it stopped feeling like mine.

## 2am

The night it cracked open, I was on a flaky test. One run in five, red. The agent fixed it, green, I exhaled, three runs later red again because the fix was a guess in a trenchcoat.

I watched myself work and I wasn't typing. I was scrolling. Reading a diff, nodding at the good parts, frowning at a `setTimeout` that smelled like a band-aid. Re-pasting the stack trace. Re-explaining the same context for the fourth time. Third loop, the agent started editing the *test* to make the failure go away.

Somewhere in there it landed: I was the for-loop. I was the exit condition. I was holding the whole control structure in my tired head and feeding it to the model one soggy prompt at a time. Plan, act, observe; it failed, so reflect, then plan again — me, by hand, at 2am, badly.

The honest version is worse. I never told it what a fix was. I never said which layer I suspected. I never set a ceiling on retries. I'd handed over the actions and kept none of the authorship — and then I was surprised it felt like babysitting.

## So I wrote the loop down

Not the code. The loop. The five decisions, out of my head and onto the page:

- **Goal** — the apostrophe bug: settings save when the company name has one.
- **Context** — the form, the API route, the last failure. Not the whole repo.
- **Actions** — edit freely, but ask me before a migration or a push.
- **Check** — the regression test goes green. Not "looks done." Green.
- **Stop** — after six tries, quit and tell me it's thrashing.

Written as a thing the machine can run, that's this:

```
loop "fix billing apostrophe bug":
  goal: settings save when the company name has an apostrophe
  done when the test "billing.spec.ts::apostrophe" passes
  look at: billing/form.tsx, api/settings.ts, and the last failure
  allow edits automatically, but ask me before migrations or pushes
  each cycle: plan, then act, then observe
  when it fails: reflect on which layer broke, then plan again
  after 6 tries: stop and warn "thrashing"
```

That is not a prompt. That is a design. Every line is one of the five decisions I'd been making at 2am, implicitly, badly. Two of them are load-bearing. `ask me before migrations or pushes` is the line that lets me actually walk away — I'm not letting an unattended loop run a schema change while I sleep. And `after 6 tries: stop and warn "thrashing"` is the one I always dropped when I *was* the loop, because the worst loops are the ones that never admit they're stuck. That line is my dwindling patience, written down, so the run doesn't depend on my patience.

It fixed the bug. That wasn't the part that mattered. The part that mattered was that the five decisions were mine again, and I could see them.

## The layering you already do by hand

Watch how you actually finish real work. You don't one-shot it. You get it working, then you fix the security thing you noticed on the way, then you refactor the ugly part, then you fix the UI the refactor knocked loose. You do that in sequence, by hand, re-establishing context at each handoff — and you drop the security pass the one time Slack pings mid-thought.

That sequence isn't overhead around the work. It *is* the work. So write it as the work — a pipeline, each story a stage:

```
pipeline "epic: checkout v2":
  stage "story: cart totals":
    goal: cart shows correct totals with tax
    done when "pnpm test cart" passes
    each cycle: plan, then act, then observe
    when it fails: reflect, then plan again
  stage "story: checkout submit":
    goal: order submits and payment is captured
    a human approves before charging the card
    done when "pnpm test checkout" passes
```

Stare at `a human approves before charging the card`. That's the most senior decision in the whole file, and it cost five words to make real and durable — not a Slack reminder, not a hope, a gate written into the structure exactly where the money moves. That's the job. That was always the job: deciding where judgment lives.

## The loop is the craft now

Here's the thesis I backed into, against my own nostalgia. A flow you'd trust and a sloppy one-shot aren't separated by a smarter model or a cleverer prompt. They're separated by whether there's a loop: self-correcting, verified, gated, with an honest stop. The anatomy — plan, act, observe, and on failure reflect and re-plan — is what turns a lucky guess into something you'd ship. Bury that anatomy in a wall of prose and you're back to being the human for-loop at 2am.

So the loop isn't the packaging around the craft. The loop *is* the craft now. It's the part only judgment can author.

## The thing I built, briefly

I made the loop a thing you write down. It's called **Loop** — a small open-source language, about fifteen words, plain English. Every snippet above is real syntax. You write a `.loop` file and it runs on Claude Code: it plans, acts, observes, reflects on failure, checks your `done when`, and stops at your gates. That's the whole idea.

I won't oversell the replacement. It's not identical to the 11pm flow of a function arriving under your hands, and some nights I still miss that one, honestly. But it gives back the part I actually missed — being the author — and it does it for work I'd never hand to a one-shot.

If any of the 2am stuff sounded familiar, try your next task as a loop instead of a prompt. Worst case, you spend ten minutes naming the five decisions you were already making anyway.
