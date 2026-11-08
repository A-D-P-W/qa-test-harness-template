# Case studies

Plain-language write-ups of selected lessons from tests/LESSONS.md. Each one: what happened,
how it was found, why it matters, what changed.

## L14: a sender check that trusted a header the sender could forge

**What happened**
MailToDrive is designed to organize important files that I'd want to catalog, archive and store.
It matters to vet the source, to ensure we do not have any security holes with injection attacks
that might be hiding in PDFs or other files.

Record: the check that decided whether a mail came from a trusted sender read a header that, on
one mail path, the sender could write themselves.

**How it was found**
I always have a secondary or tertiary review of plans, by new agents who view the plan with new
eyes, because:
1. initial implementations are usually patched piecemeal when designing something specific for the tool
2. after fixing issues, the final product is patchwork
3. how many changes were needed per round determines whether another review, with the whole code
   in context, is needed

I ask agents to roleplay as security experts in the relevant field. For MailToDrive that means an
expert in the Gmail API, another who understands the Google Drive API, and so on for the other
domains. Each expert has their own QA tester for their field, and each tester must provide a
report about what they tested. All testers' reports are combined into a test "gauntlet" for future
reference, so tests stay consistent, and the whole suite is reviewed periodically to make sure it
is efficiently designed, up to date and well written. Last, I ask all the agents to debate what
gaps there are.

I also ask a lot of questions, however silly they sound, because I'm curious about security issues
that might concern me that I may not understand are a real thing. I ask: if an agent were to attack
the system, how would they approach it? If the system produced a report about a security incident,
does it contain the information needed to act and patch the exploit? If we did a mock run of the
system in action, what would that look like?

I imagine this is how the gap was found.

Record: the Gmail-domain expert review found it (RISK D11, review 2026-10-20; tests/LESSONS.md L14).

**Why it matters**
A file containing malicious code could have had a wide variety of negative impacts on my computer.
I am not sure how bad it might have been, and that is why I am diligent about anything involving
external files being stored locally or in my cloud drives that I might need to access.

**What changed**
If an agent's recommendation reads logically to me and I understand why it's being recommended,
I'll allow it. I also make sure the script has debugging and test features, so test runs come
before anything else. Because I don't have an extensive, formal security background, I have to be
extra diligent in giving myself enough information to trust the agent designing the system. And
because I use an agent to interpret a lot of the results, the script has built-in ways to show
whether it is running properly, like health reports and dry runs.

Record: fixed in 3.7.5. tests/v375 feeds the check forged, look-alike and reordered headers, all of
which must be rejected, and was mutation-checked; the fix was calibrated on real mail.