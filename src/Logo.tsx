import { useState } from 'react'

/**
 * Uses /wecom-logo.svg from the public folder when it exists,
 * otherwise a plain text wordmark in the brand colour.
 */
export default function Logo({ className = 'h-9' }: { className?: string }) {
  const [missing, setMissing] = useState(false)
  if (!missing) {
    return <img src="/wecom-logo.svg" alt="wecom" className={`w-auto ${className}`} onError={() => setMissing(true)} />
  }
  return (
    <span className={`inline-flex flex-col justify-center font-black italic leading-[0.82] tracking-tighter text-brand-500 ${className}`} aria-label="wecom" style={{ fontSize: '1.05rem' }} dir="ltr">
      <span>we</span>
      <span>com.</span>
    </span>
  )
}
