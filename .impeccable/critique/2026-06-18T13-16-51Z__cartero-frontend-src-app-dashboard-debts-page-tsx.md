---
target: dividas page
total_score: 27
p0_count: 0
p1_count: 1
timestamp: 2026-06-18T13-16-51Z
slug: cartero-frontend-src-app-dashboard-debts-page-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Toast confirma ações; isPaid reflete no dot/strikethrough imediatamente. Sem loading state no botão durante mutation. |
| 2 | Match System / Real World | 4 | Linguagem financeira brasileira correta. Status dot faz sentido intuitivo. |
| 3 | User Control and Freedom | 3 | Toggle paid/unpaid existe. Delete exige confirmação. Parcelas têm scope dialog. Sem undo de 5s após deletar. |
| 4 | Consistency and Standards | 3 | Dot→toggle alinha com a convenção da página. Mobile usa dropdown igual ao restante do app. |
| 5 | Error Prevention | 3 | Delete confirm para itens simples, scope dialog para parcelas. |
| 6 | Recognition Rather Than Recall | 3 | Dot clickável não é óbvio — sem label, tooltip só no title (não acessível por toque). |
| 7 | Flexibility and Efficiency | 2 | Sem keyboard shortcuts. Sem bulk-action. Sem filtro por vencimento ou credor. |
| 8 | Aesthetic and Minimalist Design | 3 | Layout limpo. Tab filter + summary strip + list é hierarquia clara. |
| 9 | Error Recovery | 2 | Toasts genéricos sem sugestão. Sem retry inline. |
| 10 | Help and Documentation | 1 | Sem tooltip, sem onboarding. Dot interativo sem dica de que é clicável. |
| **Total** | | **27/40** | **Acceptable** |

## Anti-Patterns Verdict
Sem AI slop detectado. Detector: 0 findings.

## Priority Issues
- [P1] Dot interativo sem affordance de clicabilidade — usuário não descobre que o círculo é clicável
- [P2] Erros genéricos sem recovery — sheet pode fechar perdendo dados do formulário
- [P2] Sem ordenação por vencimento — lista não prioriza dívidas urgentes
- [P3] RowSkeleton não reflete estrutura atual (falta dot-button size-8)
- [P3] Summary strip gap pequeno — dois valores parecem um bloco só
