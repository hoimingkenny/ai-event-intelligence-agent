# Architecture

## Design Principle

The LLM is not the system of record. The LLM performs specialist reasoning inside a deterministic workflow.

```text
LangGraph = workflow orchestration
OpenAI Agents SDK = reasoning agents
Storage = source of truth
Search tool = external signal collection
```

## Core Modes

### Early-Warning Mode

Used for prompts such as:

```text
Find latest cyber attack news today.
Any urgent vendor-related cyber incident in the last few hours?
```

Prioritises speed, freshness, and possible vendor impact. Accepts low-confidence signals but labels them clearly.

### Confirmed Intelligence Mode

Used for prompts such as:

```text
Summarise confirmed cyber incidents this week.
Which vendor advisories affect our products?
```

Prioritises source confidence and confirmation.

## Deduplication Strategy

```text
1. URL/hash duplicate check
2. Structured identifier matching
3. SQL candidate retrieval by vendor/product/time window
4. Optional vector retrieval later
5. LLM adjudication for uncertain cases
```

Deduplication result types:

```text
same_article_duplicate
same_event_no_new_information
same_event_new_source
same_event_material_update
related_but_separate_event
separate_event
uncertain_need_human_review
```
