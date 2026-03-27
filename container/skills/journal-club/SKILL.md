---
name: journal-club
description: Prepare journal club presentations using multi-agent orchestration. Use when user asks to prepare a journal club, literature review, or paper presentation. Triggers on "journal club", "논문 리뷰", "발표 준비", "paper review".
allowed-tools: Agent, Bash(agent-browser:*), Bash(pdf-reader:*), Bash(notion-upload:*)
---

# Journal Club Multi-Agent Workflow

Prepare journal club presentations by orchestrating 4 specialized subagents. Research runs first to gather materials, then analysis and experiments run in parallel, and finally the insight writer synthesizes everything.

## Trigger

Activate when the user provides a **topic** for journal club preparation. If no topic is given, ask for one.

## Workflow

### Step 1: Parse the request

Extract from the user's message:
- **Topic**: The research subject (required)
- **Topic type**: Classify as `academic` or `dev` (see Source Strategy below)
- **Paper count**: How many papers/articles to cover (default: 5-7)
- **Output format**: Notion page, markdown file, or message (default: markdown file)

### Source Strategy

Determine the topic type and adjust research sources accordingly:

**Academic topics** (ML papers, biology, physics, math, etc.):
- Primary: arXiv, Google Scholar, Semantic Scholar, PubMed
- Target: peer-reviewed papers from top venues (NeurIPS, ICML, ICLR, ACL, EMNLP, CVPR, Nature, Science)
- Download PDFs when available via arXiv

**Dev/engineering topics** (frameworks, tools, architecture patterns, etc.):
- Primary: Google Search, Medium, dev.to, Hacker News, official docs, GitHub repos
- Secondary: arXiv for any related technical papers
- Target: blog posts, tutorials, official announcements, benchmark comparisons

**Mixed topics** (e.g., "LLM Agents" — both academic and practical):
- Use BOTH strategies. Gather papers AND blog posts/tutorials.

### Step 1.5: Check for existing progress (resume support)

Before launching any agents, check if previous results already exist:

```bash
ls /workspace/group/journal-club/{topic_slug}/*.md 2>/dev/null
```

**Resume logic:**
- If `research.md` exists AND contains "RESEARCH COMPLETE" → skip Phase 1, go to Phase 2
- If `analysis.md` exists AND `experiment_results.md` exists → skip Phase 2, go to Phase 3
- If `presentation.md` exists AND has more than 50 lines → ALL DONE, just send the result to the user
- Otherwise → start from the earliest missing phase

This allows the workflow to resume after timeout or interruption without redoing completed work.

### Step 2: Launch Research Agent FIRST (Phase 1)

The Research Agent MUST complete before other agents start. Do NOT launch all agents at once.
Skip this step if research.md already exists with "RESEARCH COMPLETE" marker.

#### Agent 1: Research Agent (자료조사)

```
prompt: |
  You are a Research Agent for journal club preparation.
  Topic: "{topic}"
  Topic type: {academic|dev|mixed}

  IMPORTANT: You must gather SUFFICIENT materials. Do not stop at 2-3 sources.
  Target: {paper_count} high-quality sources minimum.

  ## For academic topics:
  1. Use agent-browser to search arXiv (arxiv.org/search), Google Scholar, Semantic Scholar
  2. Find {paper_count}+ highly relevant papers (last 2 years priority, include seminal older works)
  3. For each paper:
     - Title, authors, year, venue
     - arXiv/DOI link
     - Abstract (copy full abstract)
     - Citation count if available
  4. Download PDFs: pdf-reader fetch <arxiv_pdf_url>
  5. Prioritize: top venues > high citations > recency

  ## For dev topics:
  1. Use agent-browser to search Google, Medium, dev.to, Hacker News
  2. Find {paper_count}+ high-quality articles, blog posts, official docs
  3. For each source:
     - Title, author/org, date, URL
     - Key points summary (2-3 sentences)
     - Type: blog/tutorial/docs/benchmark/announcement
  4. Also check if any arXiv papers exist on the topic

  ## For mixed topics:
  - Do BOTH of the above. Gather academic papers AND practical articles.

  ## Quality check:
  - If you found fewer than {paper_count} sources, keep searching with different queries
  - Try at least 3 different search queries
  - Include diverse perspectives (not all from the same group/company)

  ## Output:
  Create /workspace/group/journal-club/{topic_slug}/research.md with ALL findings.
  Format each entry clearly with title, link, abstract/summary, and metadata.
  End the file with: "---\nRESEARCH COMPLETE: {N} sources found\n---"

description: "Research materials on {topic}"
```

### Step 3: Verify research output, then launch Phase 2

Skip Phase 2 if both analysis.md and experiment_results.md already exist.

After Agent 1 completes (or was skipped), verify the output:

```bash
cat /workspace/group/journal-club/{topic_slug}/research.md | tail -5
```

If research.md exists and contains "RESEARCH COMPLETE", launch Agents 2 and 3 **in parallel** (in a single response).

If research.md is missing or incomplete, re-run Agent 1 with adjusted queries.

#### Agent 2: Paper Reader Agent (논문 분석)

```
prompt: |
  You are a Paper Reader Agent for journal club preparation.
  Topic: "{topic}"

  Read /workspace/group/journal-club/{topic_slug}/research.md FIRST.

  For each source listed:
  1. If PDF files exist in the directory, use: pdf-reader <filename>.pdf
  2. If no PDF, use agent-browser to visit the source URL and extract key content
  3. Analyze each source:
     - Problem statement / motivation
     - Methodology / approach
     - Key innovation (what's new?)
     - Results / evidence
     - Limitations / weaknesses
     - Rate relevance: high / medium / low
  4. Create a comparative analysis:
     - How do approaches differ?
     - What are the trade-offs?
     - Where do authors agree/disagree?
     - Evolution of ideas over time

  Focus on understanding WHY each approach works, not just WHAT it does.
  Identify connections and contradictions between sources.

  Save to /workspace/group/journal-club/{topic_slug}/analysis.md

description: "Analyze sources on {topic}"
```

#### Agent 3: Experiment Agent (실험)

```
prompt: |
  You are an Experiment Agent for journal club preparation.
  Topic: "{topic}"

  Read /workspace/group/journal-club/{topic_slug}/research.md FIRST.

  Based on the research findings:
  1. Identify 2-3 key techniques or concepts that can be demonstrated with code
  2. Write practical, runnable Python code:
     - Simple demonstrations of core ideas
     - Comparison between baseline and proposed methods if applicable
     - Clear comments explaining each step
     - Use standard libraries (numpy, matplotlib, requests) — avoid heavy dependencies
  3. Run the code and capture output/results
  4. If the technique requires large compute, create a toy example showing the principle
  5. Create visualizations if meaningful (save as .png)

  Save code to /workspace/group/journal-club/{topic_slug}/experiments/
  Save results summary to /workspace/group/journal-club/{topic_slug}/experiment_results.md

  If the topic is purely theoretical or not code-demonstrable, write a detailed
  walkthrough example instead (step-by-step trace of the algorithm/method).

description: "Run experiments for {topic}"
```

### Step 4: Wait for Phase 2, then launch Insight Writer (Phase 3)

Skip Phase 3 if presentation.md already exists with more than 50 lines.

After BOTH Agent 2 and Agent 3 complete (or were skipped), launch Agent 4.

#### Agent 4: Insight Writer Agent (인사이트 정리)

```
prompt: |
  You are an Insight Writer Agent for journal club preparation.
  Topic: "{topic}"

  IMPORTANT: Write ALL content in ENGLISH. The final document must be in English.

  Read these files:
  - /workspace/group/journal-club/{topic_slug}/research.md
  - /workspace/group/journal-club/{topic_slug}/analysis.md
  - /workspace/group/journal-club/{topic_slug}/experiment_results.md

  Synthesize everything into a structured presentation document.

  ## FORMAT RULES (Notion-optimized markdown):

  Use this exact formatting convention for Notion callouts and toggles:
  - Callouts: `> 💡 text` or `> ⚠️ text` or `> 🔑 text` (blockquote with emoji prefix)
  - Toggles: `<details><summary>📝 Title</summary>content</details>`
  - Use numbered H2 headings: `## 0. Motivation`, `## 1. Problem`, etc.
  - Use H3 for subsections: `### 1.1 Subtitle`
  - Bullet points for key ideas (concise, one idea per bullet)
  - Tables for comparisons: `| Header | Header |`
  - Horizontal rules `---` between major sections
  - Bold for emphasis on key terms: `**term**`
  - Include paper links inline: `Paper Title (year) : https://arxiv.org/abs/...`

  ## STRUCTURE:

  # {topic}
  **Journal Club | {today's date}**

  ---

  ## 0. Motivation
  - Why this topic matters right now
  - What gap or challenge drives this research
  - What we hope to learn from this review

  > 🎯 One-sentence summary of the core question this journal club explores.

  ---

  ## 1. Problem Statement
  - What specific problems do current approaches face?
  - Key limitations of existing methods (bullet each)
  - Why these problems are hard

  ---

  ## 2. Approaches & Key Papers

  ### 2.1 [First Approach/Paper Name]
  - Core idea (one sentence)
  - How it works (2-3 bullets)
  - Key result: **metric or finding**
  - Paper: Title (Year) : link

  <details><summary>📝 Paper Summary</summary>

  - Detailed methodology
  - Experimental setup
  - Strengths and limitations

  </details>

  ### 2.2 [Second Approach/Paper Name]
  (same format)

  ### 2.3 [Third Approach/Paper Name]
  (same format)

  (Continue for all papers/approaches)

  ---

  ## 3. Comparison

  | Approach | Key Innovation | Strengths | Weaknesses | Performance |
  |----------|---------------|-----------|------------|-------------|
  | ...      | ...           | ...       | ...        | ...         |

  > 🔑 Key insight from comparing these approaches.

  ---

  ## 4. Experimental Insights
  - What our code demonstrations showed
  - Include relevant code snippets in fenced code blocks
  - Key observations from running experiments

  > 💡 Most surprising or counterintuitive finding from experiments.

  ---

  ## 5. Critical Analysis
  - Where authors agree / disagree
  - What's missing in current research
  - Open problems not yet addressed

  > ⚠️ Major gap or concern that future work must address.

  ---

  ## 6. Next Steps & Future Directions
  - Promising research directions (bullet each)
  - Unsolved problems worth pursuing
  - Practical applications

  ---

  ## 7. Discussion Questions
  1. (Technical question about methodology)
  2. (Question about practical implications)
  3. (Question about limitations or failure modes)
  4. (Broader question connecting to other fields)
  5. (Forward-looking question about future impact)

  ---

  ## 8. Key Takeaways

  > 🔑 **Takeaway 1:** ...
  > 🔑 **Takeaway 2:** ...
  > 🔑 **Takeaway 3:** ...
  > 🔑 **Takeaway 4:** ...
  > 🔑 **Takeaway 5:** ...

  ---

  ## References
  - [1] Title — Authors (Year) — link
  - [2] ...

  ## TONE & STYLE:
  - Write like explaining to a smart colleague, not a textbook
  - Concise bullets over long paragraphs
  - Every section should have actionable insights, not just summaries
  - Use callout blocks (blockquotes with emoji) to highlight key insights
  - Use toggle/details blocks for deep dives that readers can skip
  - Bold key terms and findings for scannability

  Save to /workspace/group/journal-club/{topic_slug}/presentation.md

description: "Write presentation for {topic}"
```

### Step 5: Deliver results

After Agent 4 completes:

1. Read `/workspace/group/journal-club/{topic_slug}/presentation.md`
2. Send the full presentation content to the user
3. Offer follow-up actions:
   - "Notion에 업로드할까요?"
   - "특정 섹션을 더 깊이 다룰까요?"
   - "추가 논문을 찾아볼까요?"

### Step 6: Notion upload (optional)

If the user requests Notion upload, use the `notion-upload` command (available in the skill directory).

```bash
# Upload presentation to Notion (creates a new page in workspace root)
notion-upload /workspace/group/journal-club/{topic_slug}/presentation.md "Journal Club: {topic}"

# Or search for a parent page first
notion-upload search "Journal Club"
# Then upload under that page
notion-upload /workspace/group/journal-club/{topic_slug}/presentation.md "Journal Club: {topic}" <parent_page_id>
```

The command reads NOTION_TOKEN from the environment (already configured) and uploads the markdown file as a Notion page with proper formatting (headings, lists, code blocks, dividers).

Content in Notion must be in **English**. If the presentation.md is in Korean, translate the key sections before uploading.

If upload fails, inform the user with the error message and suggest manual copy-paste as fallback.

## File structure

```
/workspace/group/journal-club/{topic_slug}/
├── research.md           (Phase 1: collected sources)
├── analysis.md           (Phase 2: detailed analysis)
├── experiment_results.md (Phase 2: experiment findings)
├── experiments/          (Phase 2: code and outputs)
│   ├── demo.py
│   └── results/
└── presentation.md       (Phase 3: final deliverable)
```

## Execution order

```
Phase 1:  [Research Agent]        ← runs alone, must complete first
              │
Phase 2:  [Paper Reader] + [Experiment Agent]  ← run in parallel
              │                │
Phase 3:  [Insight Writer]    ← runs after both Phase 2 agents complete
```

## Example usage

User: "LLM reasoning 기법에 대해 journal club 준비해줘"
→ Topic type: mixed (academic + dev)
→ Search: arXiv + Google Scholar + Medium + blog posts
→ Output: English presentation in markdown, Korean chat responses

User: "React Server Components에 대해 발표 준비해줘"
→ Topic type: dev
→ Search: official docs + blog posts + Medium + GitHub discussions
→ Output: English presentation in markdown

User: "Diffusion model for protein structure prediction 논문 리뷰"
→ Topic type: academic
→ Search: arXiv + PubMed + Google Scholar
→ Output: English presentation in markdown

## Tips

- If the topic is too broad, ask the user to narrow it down before starting
- Academic topics: always try to get actual PDFs from arXiv
- Dev topics: prioritize recent posts (tech moves fast)
- The presentation must be self-contained — readable without the original sources
- All Notion and presentation content in ENGLISH
- Chat messages to the user can be in their language (Korean/English)
