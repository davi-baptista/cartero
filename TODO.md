# Cartero - TODO

## 1. Setup

- [x] NestJS criado com CLI
- [x] Docker + PostgreSQL configurado
- [x] Docker Compose criado e rodando
- [x] Prisma instalado e configurado (v6)
  - [x] Schema criado com todos os models
  - [x] Migrations rodadas
  - [x] PrismaClient gerado
- [x] PrismaModule criado (PrismaService com @Global)
- [x] Variáveis de ambiente (.env) configuradas
- [ ] Next.js inicializado
- [ ] shadcn/ui instalado com tema dark

## 2. Backend: Auth (JWT)

- [x] Instalar dependências: `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `bcrypt`
- [x] Criar PrismaService
- [x] Criar PrismaModule (@Global)
- [x] Criar RegisterDto e LoginDto
- [x] Criar AuthService
- [x] Criar AuthController
- [x] Criar JwtStrategy
- [x] Criar AuthModule
- [x] Criar JwtAuthGuard
- [x] Criar CurrentUser decorator
- [x] Testar endpoints /auth/register e /auth/login

## 3. Backend: Users

- [x] UserService (findById, update)
- [x] UserController com guard
- [x] UpdateUserDto
- [x] GET /users/me
- [x] PATCH /users/me

## 4. Backend: Banks

- [x] BankService (CRUD completo)
- [x] BankController com guard
- [x] DTOs (CreateBankDto, UpdateBankDto)
- [x] GET /banks
- [x] POST /banks
- [x] GET /banks/:id
- [x] PATCH /banks/:id
- [x] DELETE /banks/:id

## 5. Backend: Categories

- [x] CategoryService (CRUD completo)
- [x] CategoryController com guard
- [x] DTOs (CreateCategoryDto, UpdateCategoryDto)
- [x] GET /categories
- [x] POST /categories
- [x] GET /categories/:id
- [x] PATCH /categories/:id
- [x] DELETE /categories/:id

## 6. Backend: Transactions

- [x] TransactionService
  - [x] Criar transação (com lógica de fatura)
  - [x] Listar transações (com filtros)
  - [x] Atualizar transação
  - [x] Deletar transação
  - [x] Lógica: CREDIT_CARD vai pra fatura do banco
- [x] TransactionController com guard
- [x] DTOs
- [x] GET /transactions
- [x] GET /transactions/:id
- [x] POST /transactions
- [x] PATCH /transactions/:id
- [x] DELETE /transactions/:id
- [x] Parcelamento (criar múltiplas parcelas)

## 7. Backend: Invoices (Faturas)

- [x] InvoiceService
  - [x] Geração automática de faturas
  - [x] Pagar fatura (usa PATCH /invoices/:id)
  - [x] Calcular total
  - [x] Listar faturas por banco
- [x] InvoiceController com guard
- [x] GET /invoices
- [x] GET /invoices/:id
- [x] PATCH /invoices/:id (mudar status)
- [x] GET /banks/:id/invoices

## 8. Backend: Debts (Dívidas)

- [x] DebtService
  - [x] Corrigir bug do create (paidAt sempre setado, deve ser null se isPaid=false)
  - [x] Parcelamento (se vier `installments`, criar N registros vinculados por parentId)
- [x] DebtController com guard (controller está vazio)
- [x] DebtModule wiring (module está vazio)
- [x] DTOs
- [x] GET /debts
- [x] POST /debts
- [x] GET /debts/:id
- [x] PATCH /debts/:id
- [x] DELETE /debts/:id

## 9. Backend: Receivables (A Receber)

- [x] ReceivableService
  - [x] CRUD completo
  - [x] Parcelamento (criar N registros vinculados por parentId)
  - [x] Marcar como recebido: só seta isPaid=true e paidAt, NÃO gera transação
- [x] ReceivableController com guard
- [x] ReceivableModule wiring
- [x] DTOs
- [x] GET /receivables
- [x] POST /receivables
- [x] GET /receivables/:id
- [x] PATCH /receivables/:id
- [x] DELETE /receivables/:id
- [x] POST /receivables/:id/pay

## 10. Backend: Statement (Extrato Geral)

- [ ] GET /statement — combina: transactions + debts + receivables pagos

## 10. Backend: Alerts (Sistema de Alertas)

- [ ] AlertService
  - [ ] Buscar faturas vencidas (due_date = hoje, status != PAID)
  - [ ] Buscar dívidas pendentes (due_date = hoje, isAlertEnabled, isPaid = false)
- [ ] AlertController
- [ ] GET /alerts (retorna alertas ao abrir app)

## 11. Frontend: Setup

- [ ] Next.js inicializado
- [ ] shadcn/ui instalado
- [ ] Tema dark configurado
- [ ] Configurar variáveis de ambiente
- [ ] Configurar Axios/fetch para API

## 12. Frontend: Auth

- [ ] Página de Login
- [ ] Página de Registro
- [ ] Context de autenticação
- [ ] Protected routes (middleware)
- [ ] Login com API
- [ ] Registro com API
- [ ] Logout

## 13. Frontend: Dashboard (Layout)

- [ ] Sidebar/Navbar
- [ ] Menu de navegação
- [ ] Layout principal
- [ ] Integração com alerts ao carregar

## 14. Frontend: Banks

- [ ] Página de lista de bancos
- [ ] Formulário de criar/editar banco
- [ ] Dialog/Modal para operações
- [ ] Cores visuais

## 15. Frontend: Categories

- [ ] Página de lista de categorias
- [ ] Formulário de criar/editar categoria
- [ ] Ícones/Emojis
- [ ] Cores

## 16. Frontend: Transactions

- [ ] Página de extrato/transações
- [ ] Filtros (data, categoria, banco, tipo)
- [ ] Formulário de criar transação
- [ ] Listagem com ícones e cores
- [ ] Indicador de fatura (se tem invoiceId)

## 17. Frontend: Invoices

- [ ] Página de faturas por banco
- [ ] Detalhes da fatura (lista de transações)
- [ ] Ações: fechar, pagar
- [ ] Status visual

## 18. Frontend: Debts

- [ ] Página de dívidas
- [ ] Indicador de alerta (vencendo hoje)
- [ ] Formulário de criar/editar
- [ ] Marcar como pago
- [ ] Seleção de banco ao pagar

## 19. Frontend: Receivables

- [ ] Página de a receber
- [ ] Formulário de criar/editar
- [ ] Marcar como pago
- [ ] Seleção de banco ao receber

## ARRUMAR DEPOIS

- [ ] Criar helper de validação (validateOwnership) e trocar em todos os services

## 20. Deploy

- [ ] Backend no Railway
  - [ ] Variáveis de ambiente
  - [ ] Conexão com banco
  - [ ] Deploy
- [ ] Frontend no Vercel
  - [ ] Variáveis de ambiente
  - [ ] API URL
  - [ ] Deploy
- [ ] Testar produção
