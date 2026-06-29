# Limitations

- RSS feeds do not capture every real-time cyber event.
- Some publishers block extraction, change layout, or require JavaScript rendering.
- Playwright fallback is slower and more operationally fragile than static extraction.
- Entity extraction is deterministic and may miss obscure vendors, products, or threat names.
- LLM classification can still misclassify ambiguous articles.
- Semantic similarity creates candidates; it is not sufficient as the final event-grouping decision.
- Event grouping quality depends on embedding quality and labelled evaluation coverage.
- The current MVP does not include a full analyst review UI.
- Queue workers currently provide backend orchestration, not a complete operations dashboard.
- Source trust configuration is still basic and should be expanded before high-stakes alerting.
- Email, Slack, Teams, webhook, and ticketing integrations are future notification channels.
