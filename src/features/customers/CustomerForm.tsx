import React, {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type { Customer } from "../../types";
import toast from "react-hot-toast";

interface CustomerFormProps {
  onSubmit(customer: Omit<Customer, "id">): void | Promise<void>;
  initialCustomer?: Customer;
  mode?: "create" | "edit";
  onCancelEdit?: () => void;
}

const CustomerForm: React.FC<CustomerFormProps> = ({
  onSubmit,
  initialCustomer,
  mode = "create",
  onCancelEdit,
}) => {
  const [name, setName] = useState("");
  const [nif, setNif] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  // sempre que muda o cliente em edição, preenche o formulário
  useEffect(() => {
    if (initialCustomer) {
      setName(initialCustomer.name ?? "");
      setNif(initialCustomer.nif ?? "");
      setAddress(initialCustomer.address ?? "");
      setPhone(initialCustomer.phone ?? "");
      setNotes(initialCustomer.notes ?? "");
    } else {
      setName("");
      setNif("");
      setAddress("");
      setPhone("");
      setNotes("");
    }
  }, [initialCustomer]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) {
      toast.error("Nome e morada são obrigatórios.");
      return;
    }

    const payload: Omit<Customer, "id"> = {
      name: name.trim(),
      nif: nif.trim() || undefined,
      address: address.trim(),
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    await onSubmit(payload);

    if (mode === "create") {
      setName("");
      setNif("");
      setAddress("");
      setPhone("");
      setNotes("");
    }
  };

  const title =
    mode === "edit" ? "Editar cliente" : "Novo cliente";

  const submitLabel =
    mode === "edit" ? "Atualizar cliente" : "Guardar cliente";

  return (
    <form className="card form-card" onSubmit={handleSubmit}>
      <h2 className="card-title">{title}</h2>
      <p className="card-subtitle">
        {mode === "edit"
          ? "Atualiza os dados do cliente selecionado."
          : "Regista aqui um cliente para poderes fazer-lhe entregas."}
      </p>

      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="name">Nome</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Padaria do Bairro"
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="nif">NIF</label>
          <input
            id="nif"
            value={nif}
            onChange={(e) => setNif(e.target.value)}
            placeholder="Ex: 123 456 789"
          />
        </div>

        <div className="form-field form-field-full">
          <label htmlFor="address">Morada</label>
          <input
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Ex: Rua Principal 10, 3840-000 Vagos"
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="phone">Telefone</label>
          <input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Ex: 912 345 678"
          />
        </div>

        <div className="form-field form-field-full">
          <label htmlFor="notes">Notas</label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: prefere entregas de manhã, tocar ao portão lateral..."
            rows={3}
          />
        </div>
      </div>

      <div className="form-actions" style={{ gap: "0.5rem" }}>
        {mode === "edit" && onCancelEdit && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancelEdit}
          >
            Cancelar edição
          </button>
        )}

        <button type="submit" className="btn-primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
};

export default CustomerForm;
