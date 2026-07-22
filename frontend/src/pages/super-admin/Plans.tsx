import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listPlans, type PlanWithFeatures } from "../../api/superAdminPlans";
import { useToast } from "../../components/Toast";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "../../components/Table";

function formatINR(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export default function Plans() {
  const { showToast } = useToast();
  const [plans, setPlans] = useState<PlanWithFeatures[] | null>(null);

  useEffect(() => {
    listPlans()
      .then(setPlans)
      .catch(() => {
        showToast("Could not load plans.", "error");
        setPlans([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="px-8 py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Plans</h1>
      <p className="mt-1 text-sm text-neutral-500">
        The 4 subscription products every business is assigned to (or not). Edit a plan's feature grid here —
        changes apply immediately to every tenant on that plan. To change which plan a specific business is on,
        use that business's detail page.
      </p>

      <div className="mt-6">
        {plans === null ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <Th>Plan</Th>
                <Th>Monthly</Th>
                <Th>Yearly</Th>
                <Th>Features included</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </TableHead>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <Td className="font-medium text-neutral-900">
                    {plan.name}
                    {plan.isFeatured && (
                      <span className="ml-2 inline-flex rounded-full bg-gold/20 px-2 py-0.5 text-xs font-semibold text-maroon">Most Popular</span>
                    )}
                  </Td>
                  <Td className="text-neutral-600">{formatINR(plan.priceMonthly)}/mo</Td>
                  <Td className="text-neutral-600">{formatINR(plan.priceYearly)}/yr</Td>
                  <Td className="text-neutral-600">{plan.features.filter((f) => f.included).length} / {plan.features.length}</Td>
                  <Td>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        plan.isActive ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {plan.isActive ? "Active" : "Inactive"}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <Link to={`/super-admin/plans/${plan.id}`} className="text-xs font-semibold text-maroon hover:underline">
                      Edit
                    </Link>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
