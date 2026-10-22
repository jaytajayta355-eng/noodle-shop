import { useEffect } from 'react'

// Marks [data-shown] (not a class, which React would overwrite on re-render) once an element with [data-reveal] scrolls into view.
export default function useReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.setAttribute('data-shown', ''); observer.unobserve(e.target) } }), { threshold: .15 })
    const scan = () => document.querySelectorAll('[data-reveal]:not([data-shown])').forEach(el => observer.observe(el))
    scan()
    const mutations = new MutationObserver(scan); mutations.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect(); mutations.disconnect() }
  }, [])
}
