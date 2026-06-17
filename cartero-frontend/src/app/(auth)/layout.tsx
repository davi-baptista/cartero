export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
        {children}
      </div>
    </div>
  )
}
