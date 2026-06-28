<!--
  plan.md — the HUMAN-READABLE spec (a STARTER you replace).

  This is the document a person reads, reviews, and signs off on before the loop
  runs. It is NOT parsed by loop-run; it is the source of truth that keeps you and
  the machine agreed on scope. After you write/refine it here, mirror each story
  into sprint.yaml as a structured `stories:` entry — that YAML is what
  load-spec.loop actually iterates with `for each`.

  Replace everything below with your real epic and stories.
-->

# Epic: Authentication

## Summary

Let users create an account, sign in, and recover access to it. Sessions are
issued on login and expire after inactivity. Email is the identifier; passwords
are hashed at rest. This epic delivers the minimum secure auth surface the rest
of the product builds on.

<!-- TODO: replace the summary above with your epic's one-paragraph context:
     what it is, why now, and the boundary of what's in vs out of scope. -->

## Stories

Each story below has a one-to-one counterpart in `sprint.yaml`. The **Acceptance**
line is the testable contract — phrase it so it maps to a real assertion, because
the `done when` test in `story-template.loop` is what proves the story is done.

### 1. User can log in

- **Epic:** Authentication
- **What:** A registered user signs in with email + password.
- **Acceptance:** valid credentials return a session; invalid credentials are
  rejected with a generic error (no user-enumeration leak).

### 2. User can sign up

- **Epic:** Authentication
- **What:** A new visitor creates an account.
- **Acceptance:** a unique email + valid password creates the account and sends a
  verification email; duplicate emails are rejected.

### 3. User can reset their password

- **Epic:** Authentication
- **What:** A user who forgot their password regains access.
- **Acceptance:** requesting a reset emails a single-use, expiring link; following
  it lets the user set a new password and invalidates the old one.

<!-- TODO: add/remove stories to match your sprint, then keep sprint.yaml in sync. -->
