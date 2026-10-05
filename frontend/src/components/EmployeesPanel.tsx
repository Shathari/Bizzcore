import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { listEmployees, createEmployee, setEmployeeActive, type Employee } from "../api/employees";
import { Button } from "./Button";
import { Card } from "./Card";
import { Modal } from "./Modal";

export function EmployeesPanel() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function fail(err: unknown) { setError(axios.isAxiosError(err) ? err.response?.data?.error ?? "Could not update employees" : "Could not update employees"); }
  async function load() { setEmployees(await listEmployees()); }
  useEffect(() => { load().catch(fail); }, []);
  function close() { if (busy) return; setOpen(false); setPassword(""); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await createEmployee({ name, email, temporaryPassword: password }); setOpen(false); setPassword(""); setName(""); setEmail(""); setNotice("Employee created. Share the temporary password securely; they must change it at sign-in."); await load(); }
    catch (err) { fail(err); } finally { setBusy(false); }
  }
  async function toggle(employee: Employee) {
    if (busy) return; setBusy(true); setError("");
    try { await setEmployeeActive(employee.id, !!employee.disabledAt); await load(); }
    catch (err) { fail(err); } finally { setBusy(false); }
  }
  return <Card><section aria-label="Team / Employees" className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h2 className="font-serif text-lg">Team / Employees</h2><Button disabled={busy} onClick={() => { setError(""); setNotice(""); setOpen(true); }}>+ Add Employee</Button></div>
    {error && !open && <p role="alert" className="text-red-600">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!employees ? <p>Loading employees…</p> : !employees.length ? <p>No employees yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Name", "Login/email", "Status", "Created", "Actions"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td className="p-2">{employee.name}</td><td className="p-2">{employee.email}</td><td className="p-2">{employee.disabledAt ? "DISABLED" : "ACTIVE"}</td><td className="p-2">{new Date(employee.createdAt).toLocaleDateString()}</td><td className="p-2"><Button variant="secondary" disabled={busy} onClick={() => toggle(employee)}>{employee.disabledAt ? "Reactivate" : "Disable"}</Button></td></tr>)}</tbody></table></div>}
    <Modal open={open} onClose={close} title="Add Employee"><form onSubmit={submit} className="space-y-3">
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <label className="block">Employee name<input className="mt-1 w-full rounded-xl border p-3" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} /></label>
      <label className="block">Employee email<input className="mt-1 w-full rounded-xl border p-3" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} /></label>
      <label className="block">Temporary password<input className="mt-1 w-full rounded-xl border p-3" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} /></label>
      <p className="text-sm">Share securely. The employee must change this password before recording sales.</p>
      <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create employee"}</Button>
    </form></Modal>
  </section></Card>;
}
