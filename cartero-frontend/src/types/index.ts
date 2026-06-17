export enum TransactionType {
  INCOME = 'INCOME',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  PIX = 'PIX',
  BOLETO = 'BOLETO',
}

export enum InvoiceStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
}

export enum InstallmentScope {
  ONE = 'ONE',
  NEXT = 'NEXT',
  ALL = 'ALL',
}

export interface User {
  id: string
  email: string
  name: string
  salary?: number
  createdAt: string
  updatedAt: string
}

export interface Bank {
  id: string
  userId: string
  name: string
  invoiceCloseDate: number
  invoiceDueDate: number
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  userId: string
  name: string
  color?: string
  icon?: string
  createdAt: string
  updatedAt: string
}

export interface Transaction {
  id: string
  userId: string
  bankId: string
  categoryId: string
  invoiceId?: string
  parentId?: string
  type: TransactionType
  title: string
  amount: number
  description?: string
  date: string
  bank?: Bank
  category?: Category
  invoice?: Invoice
  createdAt: string
  updatedAt: string
}

export interface Invoice {
  id: string
  userId: string
  bankId: string
  month: number
  year: number
  status: InvoiceStatus
  totalAmount: number
  bank?: Bank
  transactions?: Transaction[]
  createdAt: string
  updatedAt: string
}

export interface Debt {
  id: string
  userId: string
  creditorName: string
  title: string
  amount: number
  description?: string
  dueDate: string
  isAlertEnabled: boolean
  isPaid: boolean
  paidAt?: string
  parentId?: string
  createdAt: string
  updatedAt: string
}

export interface Receivable {
  id: string
  userId: string
  debtorName: string
  title: string
  amount: number
  description?: string
  dueDate: string
  isPaid: boolean
  paidAt?: string
  parentId?: string
  createdAt: string
  updatedAt: string
}

export interface AuthResponse {
  accessToken: string
  user: User
}

export interface TransactionFilters {
  startDate?: string
  endDate?: string
  bankId?: string
  categoryId?: string
  type?: TransactionType
}

export interface ApiError {
  message: string
  statusCode: number
}
