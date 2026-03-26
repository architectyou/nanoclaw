---
name: journal-club
description: Prepare journal club presentations using multi-agent orchestration. Use when user asks to prepare a journal club, literature review, or paper presentation. Triggers on "journal club", "논문 리뷰", "발표 준비", "paper review".
allowed-tools: Agent, Bash(agent-browser:*), Bash(pdf-reader:*)
---

# Journal Club Multi-Agent Workflow

Prepare journal club presentations by orchestrating 4 specialized subagents in parallel. Each agent handles a distinct phase of preparation, and results are synthesized into a final deliverable.

## Trigger

Activate when the user provides a **topic** for journal club preparation. If no topic is given, ask for one.

## Workflow

### Step 1: Parse the request

Extract from the user's message:
- **Topic**: The research subject (required)
- **Paper count**: How many papers to cover (default: 3-5)
- **Output format**: Notion page, markdown file, or message (default: markdown file)
- **Language**: Korean or English (default: match user's language)

### Step 2: Launch 4 subagents in parallel

You MUST launch all 4 agents in a single response using the Agent tool. Do NOT run them sequentially.

#### Agent 1: Research Agent (자료조사)

```
prompt: |
  You are a Research Agent for journal club preparation.
  Topic: "{topic}"

  Your task:
  1. Use agent-browser to search Google Scholar, arXiv, Semantic Scholar for recent papers (last 2 years)
  2. Find {paper_count} highly relevant and impactful papers
  3. For each paper, collect:
     - Title, authors, year, venue
     - arXiv/DOI link
     - Abstract
     - Citation count if available
  4. If PDFs are accessible, download them using: pdf-reader fetch <url>
  5. Save all findings to /workspace/group/journal-club/{topic_slug}/research.md

  Prioritize papers from top venues (NeurIPS, ICML, ICLR, ACL, EMNLP, Nature, Science).
  Include a mix of seminal works and recent advances.

description: "Research papers on {topic}"
```

#### Agent 2: Paper Reader Agent (논문 분석)

```
prompt: |
  You are a Paper Reader Agent for journal club preparation.
  Topic: "{topic}"

  Your task:
  1. Wait for /workspace/group/journal-club/{topic_slug}/research.md to appear (check every 5 seconds, timeout after 120 seconds)
  2. Read the research findings
  3. For each paper found:
     - If PDF exists in the directory, use pdf-reader to extract text
     - Analyze: Problem statement, methodology, key innovation, experimental setup, main results, limitations
     - Rate relevance to the topic (high/medium/low)
  4. Create a comparative analysis table
  5. Save analysis to /workspace/group/journal-club/{topic_slug}/analysis.md

  Focus on understanding WHY each approach works, not just WHAT it does.
  Identify connections and contradictions between papers.

description: "Analyze papers on {topic}"
```

#### Agent 3: Experiment Agent (실험)

```
prompt: |
  You are an Experiment Agent for journal club preparation.
  Topic: "{topic}"

  Your task:
  1. Wait for /workspace/group/journal-club/{topic_slug}/research.md to appear (check every 5 seconds, timeout after 120 seconds)
  2. Read the research findings to understand the key techniques
  3. Write practical, runnable code that demonstrates the core concepts:
     - Simple reproduction or demonstration of key ideas
     - Comparison between baseline and proposed methods
     - Clear comments explaining each step
  4. Run the code and capture results (use Python, keep dependencies minimal)
  5. Save code to /workspace/group/journal-club/{topic_slug}/experiments/
  6. Save results summary to /workspace/group/journal-club/{topic_slug}/experiment_results.md

  Keep experiments simple and illustrative — this is for a presentation, not a full reproduction.
  If the technique requires large compute, create a toy example that shows the principle.

description: "Run experiments for {topic}"
```

#### Agent 4: Insight Writer Agent (인사이트 정리)

```
prompt: |
  You are an Insight Writer Agent for journal club preparation.
  Topic: "{topic}"
  Language: {language}

  Your task:
  1. Wait for these files to appear (check every 10 seconds, timeout after 300 seconds):
     - /workspace/group/journal-club/{topic_slug}/analysis.md
     - /workspace/group/journal-club/{topic_slug}/experiment_results.md
     (Start writing the introduction while waiting)
  2. Synthesize all findings into a presentation document
  3. Structure:

     ## 1. Introduction (왜 이 주제인가?)
     - Research motivation and importance
     - Current challenges in the field

     ## 2. Paper Overview (논문 요약)
     - Summary table of all papers
     - Timeline of developments

     ## 3. Deep Dive (핵심 분석)
     - Methodology comparison
     - Key innovations explained simply
     - Figures/diagrams described in text (for later creation)

     ## 4. Experimental Insights (실험 결과)
     - What experiments showed
     - Code snippets for demonstration

     ## 5. Critical Discussion (비판적 논의)
     - Strengths and weaknesses of each approach
     - What's missing in current research
     - Potential future directions

     ## 6. Discussion Questions (토론 주제)
     - 3-5 thought-provoking questions for group discussion

     ## 7. Key Takeaways (핵심 정리)
     - 3-5 bullet points summarizing the most important insights

  4. Save to /workspace/group/journal-club/{topic_slug}/presentation.md

description: "Write presentation for {topic}"
```

### Step 3: Monitor and synthesize

After launching all agents, inform the user that preparation is in progress. When agents complete:

1. Read `/workspace/group/journal-club/{topic_slug}/presentation.md`
2. Send the final presentation content to the user
3. Offer follow-up actions:
   - "Notion에 업로드할까요?" (if Notion MCP is available)
   - "특정 섹션을 더 자세히 다룰까요?"
   - "토론 질문을 더 추가할까요?"

### Step 4: Notion upload (optional)

If the user requests Notion upload and Notion MCP tools are available:

```bash
# Check if Notion MCP is configured
which notion-upload 2>/dev/null || echo "Notion MCP not configured"
```

If available, use the `notion-upload` tool to create a new page under the user's specified database.

## File structure

```
/workspace/group/journal-club/{topic_slug}/
├── research.md           (Agent 1 output)
├── analysis.md           (Agent 2 output)
├── experiment_results.md (Agent 3 output)
├── experiments/          (Agent 3 code)
│   ├── demo.py
│   └── results/
└── presentation.md       (Agent 4 final output)
```

## Example usage

User: "LLM reasoning 기법에 대해 journal club 준비해줘"

Response: Launch 4 agents, then deliver presentation.md content.

## Tips

- If the topic is broad, ask the user to narrow it down
- If papers require paid access, use arXiv preprints or open-access versions
- For code experiments, prefer Python with standard libraries (numpy, matplotlib)
- The presentation should be self-contained — readable without the original papers
