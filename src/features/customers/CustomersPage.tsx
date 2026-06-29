import React, { useState } from "react";
import type { Customer } from "../../types";
import CustomerForm from "./CustomerForm";
import CustomerList from "./CustomerList";
import { useCustomers } from "../../context/CustomersContext";
import { LoadingCard } from "../../components/LoadingCard";
import { useConfirm } from "../../components/ConfirmProvider";
import toast from "react-hot-toast";

const CustomersPage: React.FC = () => {
  const confirm = useConfirm();
  const {
    customers,
    loadingCustomers,
    createCustomer,
    updateCustomer,
    deleteCustomer,
  } = useCustomers();

  const [editingCustomer, setEditingCustomer] =
    useState<Customer | null>(null);

  const handleSubmit = async (data: Omit<Customer, "id">) => {
    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, data);
        setEditingCustomer(null);
      } else {
        await createCustomer(data);
      }
    } catch {
      toast.error("Não foi possível guardar o cliente.");
    }
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
  };

  const handleDelete = async (customer: Customer) => {
    const ok = await confirm({
      title: "Apagar cliente",
      message: `Tens a certeza que queres apagar o cliente "${customer.name}"?`,
      confirmLabel: "Apagar",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await deleteCustomer(customer.id);
      if (editingCustomer?.id === customer.id) {
        setEditingCustomer(null);
      }
    } catch {
      toast.error("Não foi possível apagar o cliente.");
    }
  };

  return (
    <div className="page customers-page">

      <header className="page-header">
        <div>
          <h1>Clientes</h1>
          <p className="page-subtitle">
            Gere aqui os clientes para quem fazes entregas.
          </p>
        </div>
      </header>

      <div className="page-grid-vertical">
        <CustomerForm
          mode={editingCustomer ? "edit" : "create"}
          initialCustomer={editingCustomer ?? undefined}
          onSubmit={handleSubmit}
          onCancelEdit={() => setEditingCustomer(null)}
        />

        {loadingCustomers ? (
          <LoadingCard message="A carregar clientes..." />
        ) : (
          <CustomerList
            customers={customers}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
};

export default CustomersPage;
