import { createContext, useContext } from 'react'
import type { Employee } from './types.ts'

export const EmployeesContext = createContext<Employee[]>([])

/** Employees that can be put on a shift. */
export const useEmployees = () => useContext(EmployeesContext)

export function useNameOf() {
  const all = useEmployees()
  return (id: string) => all.find((e) => e.id === id)?.name ?? id
}
