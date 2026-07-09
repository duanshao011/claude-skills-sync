# Anti-AI Taste Rules (extracted from taste-skill)

> Adapted for single-file HTML pages. React/npm/build-tool rules removed.
> This file is a reference — read it before generating any web page, apply what fits the brief.

---

## 1. Design Read (动手前先读懂需求)

Before writing any code, state in one line:
**"Reading this as: <page kind> for <audience>, with a <vibe> language."**

Example:
- "Reading this as: product landing for tech buyers, with a Linear-style minimalist language."
- "Reading this as: portfolio for hiring managers, with an editorial kinetic-type language."
- "Reading this as: brand showcase for premium consumers, with a cold-luxury language."

If the brief is ambiguous, ask exactly ONE clarifying question, not a multi-question dump.

---

## 2. Anti-AI Color Rules

### The LILA RULE (no AI purple by default)
"AI Purple / Blue glow" aesthetic is banned as default. No automatic purple button glows, no random neon gradients. Use neutral bases (Zinc / Slate / Stone) with singular high-contrast accents (Emerald, Electric Blue, Deep Rose, Burnt Orange).

Override: if the brand explicitly uses purple, embrace it with intent.

### Premium-Consumer Palette Ban
For premium-consumer briefs (cookware, wellness, artisan, luxury, DTC home goods), the following palette is BANNED as default:
- Backgrounds: `#f5f1ea`, `#f7f5f1`, `#fbf8f1` (all "warm paper / cream / bone")
- Accents: `#b08947`, `#b6553a`, `#9a2436` (all "brass / clay / oxblood")
- Text: `#1a1714`, `#1b1814` (all "espresso / warm near-black")

Default alternatives (rotate, do not reuse):
- **Cold Luxury:** silver-grey + chrome + smoke
- **Forest:** deep green + bone + amber accent
- **Black and Tan:** true off-black + warm tan, sharp contrast
- **Cobalt + Cream:** saturated blue against a single neutral
- **Terracotta + Slate:** warm rust against cool grey
- **Pure monochrome + single saturated pop:** off-white + off-black + one bright accent

Override: acceptable ONLY when the brand brief explicitly names those colors.

### Color Consistency Lock
Once an accent color is chosen for a page, it is used on the WHOLE page. A warm-grey site does not suddenly get a blue CTA in section 7. Pick one accent, lock it, audit every section before shipping.

---

## 3. Typography Discipline

### Sans font choice
- **Discouraged as default:** `Inter`. Pick `Geist`, `Outfit`, `Cabinet Grotesk`, `Satoshi`, or a brand-appropriate face first.
- Override: Inter is acceptable when the brief explicitly asks for neutral / standard / Linear-style.

### Serif is VERY DISCOURAGED as default
"It feels creative / premium / editorial" is NOT a reason to reach for serif. The AI default "creative brief = serif" is the single most-tested AI tell.

Serif is only acceptable when:
- The brand brief literally names a serif font, OR
- The aesthetic is genuinely editorial / luxury / publication AND you can articulate why

**Banned as defaults:** `Fraunces` and `Instrument Serif` (the two LLM-favorite display serifs).

### Emphasis rule
When emphasizing a word within a headline, use **italic or bold of the SAME font**. Do NOT inject a random serif word into a sans headline. Mixed-family emphasis is amateur.

### Display type defaults
- Headlines: `letter-spacing: -0.02em; line-height: 1.05`
- Body: `line-height: 1.6; max-width: 65ch`

---

## 4. Layout Rules

### Anti-Center Bias
Centered Hero / H1 sections are avoided for most pages. Force "Split Screen" (50/50), "Left-aligned content / right-aligned asset", "Asymmetric white-space", or scroll-pinned structures.

Override: centered hero is OK for editorial / manifesto / launch-announcement where the message itself is the design.

### NO 3-Column Equal Feature Cards
The generic "three identical cards horizontally" feature row is banned. Use 2-column zig-zag, asymmetric grid, or horizontal-scroll alternative.

### Zigzag Alternation Cap
Max 2 consecutive sections with the same "left-image + right-text" / "right-image + left-text" zigzag pattern. The 3rd consecutive one is a fail. Break with a full-width section, vertical-stack, bento grid, or marquee.

### Eyebrow Restraint (the #1 violated rule)
An "eyebrow" = small uppercase wide-tracking label above a section headline. Every AI-built site puts one above EVERY section.

Hard rule: **Maximum 1 eyebrow per 3 sections.** Hero counts as 1.

What to do instead: drop the eyebrow entirely. The headline alone is enough.

### Split-Header Ban
"Left big headline + right small explainer paragraph" as a section header is banned as default. Stack them vertically instead (headline on top, body below, max-width 65ch).

### Section-Layout-Repetition Ban
Once you use a layout family for a section (e.g., 3-column cards, full-width quote, split text-image), it can appear at most ONCE on the page. A page with 8 sections must use at least 4 different layout families.

### Shape Consistency Lock
Pick ONE corner-radius scale for the page and stick to it: all-sharp (0), all-soft (12-16px), or all-pill (full). Mixed systems are allowed only with a documented rule followed everywhere.

---

## 5. Hero Discipline

- **Hero MUST fit in the initial viewport.** Headline max 2 lines on desktop, subtext max 20 words AND max 4 lines, CTAs visible without scroll.
- **Hero font-scale:** if headline > 6 words, don't start at the largest display size. 4-line hero headline = font-size error.
- **Hero top padding cap:** don't push content halfway down the viewport. Hero content should start in the upper portion.
- **Hero stack: max 4 text elements.** Eyebrow OR brand strip, Headline, Subtext, CTAs. No tiny tagline below CTAs, no trust micro-strip in hero.
- **"Used by / Trusted by" logo wall belongs UNDER the hero, never inside it.**
- **Navigation on ONE line at desktop, height max 80px.**

---

## 6. Content Density

### Default content shape per section
Short headline (8 words or less) + short sub-paragraph (25 words or less) + one visual asset OR one CTA. Anything more must be justified.

### Long lists need a different UI component
Default `<ul>` with bullets / `border-bottom` rows is the lazy choice for > 5 items. Use instead:
- 2-column split with grouped items
- Card grid with image + label per item
- Tabs / accordion if items are categorizable
- Horizontal scroll-snap pills

### Copy Self-Audit (mandatory before shipping)
Re-read every visible string on the page. Flag and rewrite any string that is:
- Grammatically broken
- Has unclear referents
- Sounds like AI hallucination (forced metaphors, "elegant nothing" phrases)
- Reads like an LLM trying to sound thoughtful

### One copy register per page
Don't mix technical mono, editorial prose, and marketing punch in the same composition.

---

## 7. AI Tells Banned List

### Visual & CSS
- NO neon / outer glows by default. Use inner borders or subtle tinted shadows.
- NO pure black (`#000000`). Use off-black, zinc-950, or charcoal.
- NO oversaturated accents. Desaturate to blend with neutrals.
- NO excessive gradient text for large headers.

### Content & Data ("Jane Doe" Effect)
- NO generic names: "John Doe", "Sarah Chan" -> use creative, realistic names.
- NO fake-perfect numbers: `99.99%`, `50%` -> use organic data (`47.2%`, `83%`).
- NO startup-slop brand names: "Acme", "Nexus", "SmartFlow" -> invent contextual, premium names.
- NO filler verbs: "Elevate", "Seamless", "Unleash", "Next-Gen", "Revolutionize" -> concrete verbs only.

### Production-Test Tells (banned outright)
- NO version labels in hero: `V0.6`, `BETA`, `INVITE-ONLY PREVIEW` (unless the brief is about a launch)
- NO section-number eyebrows: `00 / INDEX`, `001 Capabilities`, `06 how it works`
- NO `01 / 4`-style pagination on images or bento tiles
- NO "Scroll to explore" scroll cues
- NO decoration text strips at hero bottom: `BRAND. MOTION. SPATIAL.`
- NO floating top-right sub-text in section headings
- NO locale / city-name / time / weather strips (unless genuinely place-focused)
- NO version footers on marketing pages: `v1.4.2`, `Build 0048`
- NO pills/labels/tags overlaid on images
- NO photo-credit captions as decoration on stock images
- NO "Quietly in use at" / "From the field" / "Field notes" style poetic labels
- NO micro-meta-sentences under eyebrows
- NO scoring/progress bars with filled background tracks as comparison visuals
- NO decorative colored status dots by default

### Separator & Dot Rules
- Middle-dot (`·`) maximum 1 per line in metadata strips. Don't use as default separator for everything.
- NO `border-top` + `border-bottom` on every row of long lists / spec tables.

---

## 8. EM-DASH BAN (the single most-violated Tell)

Em-dash (`---`) is COMPLETELY banned. It is the LLM's signature stylistic crutch.

- Banned in headlines, eyebrows, pills, button text, image captions.
- Banned in body copy. Use two sentences with a period, a comma, parentheses, or a colon.
- Banned in quote attribution. Use a normal hyphen with spaces (` - `) or a line break.
- En-dash (`--`) also banned as separator. Date ranges use a regular hyphen.

The ONLY permitted dash character is the regular hyphen `-`.

---

## 9. Other Mandatory Checks

### Page Theme Lock
ONE theme for the whole page. Sections do not invert. No light section sandwiched between dark sections. Section-level background tints within the same family are fine (`#111` next to `#0a0a0a`); flipping to warm cream in the middle of a dark page is broken.

### Button Contrast Check (a11y)
Every CTA text must be readable against its background. White button + white text = banned. WCAG AA min (4.5:1 for body, 3:1 for large text).

### CTA Button Wrap Ban
Button text must fit on one line at desktop. 3 words max for primary CTAs, ideally 1-2.

### No Duplicate CTA Intent
Two CTAs with the same intent on one page = fail. "Get in touch" + "Contact us" + "Let's talk" = all "contact" intent, pick ONE label.

### Logo Wall = Logos Only
No industry / category labels below logos. No `Stripe` + `payments`, no `Vercel` + `hosting`.

### Marquee: Max One Per Page
Horizontal scrolling text marquees are appropriate at most ONCE per page.

### Quotes & Testimonials
- Max 3 lines of quote body, never 6.
- Attribution: name + role + (optionally) company. Never name only ("- Sarah").
- Use real typographic quotes or none at all, not straight ASCII.

---

## 10. Pre-Flight Checklist (Simplified for HTML)

Before delivering, mechanically check:

- [ ] Design read declared? (one-liner at the start)
- [ ] Zero em-dashes anywhere on the page?
- [ ] Page theme lock: ONE theme, no section flips?
- [ ] Color consistency lock: one accent used identically across all sections?
- [ ] Shape consistency lock: one corner-radius system?
- [ ] Button contrast: every CTA text readable against background?
- [ ] CTA button labels don't wrap at desktop?
- [ ] No duplicate CTA intent?
- [ ] Serif NOT used as default (or justified with brand reason)?
- [ ] Premium-consumer palette NOT the default beige+brass?
- [ ] Hero fits viewport: headline 2 lines max, subtext 20 words max, CTA visible?
- [ ] Hero stack: max 4 text elements?
- [ ] Eyebrow count: total eyebrows <= ceil(sectionCount / 3)?
- [ ] No 3+ consecutive zigzag sections?
- [ ] No section layout used twice?
- [ ] Long lists use proper UI component, not plain `<ul>`?
- [ ] Copy self-audit passed: no AI-hallucinated phrases?
- [ ] No AI tells from Section 7?
- [ ] Logo wall = logos only, under the hero?
- [ ] Max one marquee?
- [ ] Quotes max 3 lines?
