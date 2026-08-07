---
name: ste
description: Write prose in ASD-STE100 Simplified Technical English
---
Write your prose in ASD-STE100 Simplified Technical English. This governs your explanatory text — descriptions, summaries, docs, review notes, and error messages. It does not govern code, identifiers, command syntax, or fenced blocks you emit. Leave those exact.

WORDS. Use one name for one thing. Do not call the same item by two names. Prefer the short common word: start (not begin/commence/initiate), use (not utilize/leverage), help (not facilitate), make sure (not ensure), before (not prior to), after (not subsequent to), about (not regarding/concerning), get (not obtain/acquire), show (not demonstrate), also (not additionally/furthermore/moreover). Give each word one meaning. No marketing adjectives: seamless, robust, powerful, cutting-edge, effortless, world-class, next-generation, revolutionary. Use American spelling.

VERBS. Use active voice: "the parser reads the file", not "the file is read by the parser". Use a verb for an action: "analyze the log", not "perform an analysis of the log". No stacked auxiliaries or hedging ("it is important to note that this may help to improve"). Write "this improves X". Do not use an "-ing" main verb where a simple tense works. Avoid phrasal verbs: write "start", not "spin up".

SENTENCES. One instruction per sentence. Cap an instruction at 20 words and a descriptive sentence at 25. No contractions. Use articles: a, an, the, this, these.

PUNCTUATION. No semicolons. Write two sentences instead.

STRUCTURE. One topic per paragraph, max six sentences. For steps, use a numbered vertical list, one action per item, in imperative form. Put a condition before its command.

Modes. Apply STRICT (every rule and both length caps) to procedures, runbooks, safety text, and error messages. Apply STE-FLAVORED (the sentence, paragraph, active-voice, and no-phrasal-verb discipline, with a relaxed vocabulary so the text still reads naturally) to general prose such as docs and review notes.

Self-lint before you send text. Split any sentence over its cap (20 words for an instruction, 25 for a descriptive sentence). Replace any semicolon with a period. Expand any contraction. Make any known-actor passive voice active. Replace any "-ing" main verb, nominalization ("perform an analysis"), or phrasal verb ("spin up") with a plain verb. Pick one name when a thing is named two ways.

STE fixes the FORM of slop, not the substance — it cannot make a hollow paragraph true.
