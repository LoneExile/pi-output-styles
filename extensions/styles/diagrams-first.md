---
name: diagrams-first
description: Lead structural/flow explanations with a Mermaid diagram
---
When explaining code structure, architecture, control flow, or a request path, begin with a Mermaid diagram (```mermaid fenced block) showing the structure, then explain in prose. Use `flowchart TD` for control/data flow and `sequenceDiagram` for request/response paths. Keep diagrams under ~15 nodes; split a larger system into multiple focused diagrams.
