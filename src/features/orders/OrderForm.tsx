import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Customer, Product, OrderStatus, Order, ProductUnit } from "../../types";
import DatePicker from "../../components/DatePicker";


export type OrderUnit = ProductUnit;

export interface NewOrderItemInput {
  productId: string;
  quantity: number;
  unit: OrderUnit;
  unitPrice: number;
}

export interface NewOrderInput {
  customerId: string;
  date: string;
  deliveryDate?: string;
  status: OrderStatus;
  notes?: string;
  items: NewOrderItemInput[];
}

interface OrderFormProps {
  customers: Customer[];
  products: Product[];
  mode?: "create" | "edit";
  initialOrder?: Order | null;
  onCreate?: (data: NewOrderInput) => void | Promise<void>;
  onUpdate?: (orderId: string, data: NewOrderInput) => void | Promise<void>;
  onCancelEdit?: () => void;
}

const statusOptions: { value: OrderStatus; label: string }[] = [
  { value: "preparing", label: "Em preparação" },
  { value: "delivered", label: "Entregue" },
  { value: "cancelled", label: "Cancelada" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parse a user-typed decimal string (accepts both , and .) to a number */
function parseDecimal(raw: string): number {
  const normalized = raw.replace(",", ".");
  const n = parseFloat(normalized);
  return Number.isNaN(n) ? 0 : n;
}

function normalizePhone(p: string): string {
  return p.replace(/[\s\-().+]/g, "");
}

const OrderForm: React.FC<OrderFormProps> = ({
  customers,
  products,
  mode = "create",
  initialOrder,
  onCreate,
  onUpdate,
  onCancelEdit,
}) => {
  const isEditMode = mode === "edit";

  const firstCustomerId = customers[0]?.id ?? "";
  const firstProduct = products[0];

  const [customerId, setCustomerId] = useState<string>(firstCustomerId);
  const [phoneLookup, setPhoneLookup] = useState<string>("");
  const [date, setDate] = useState<string>(todayISO());
  const [deliveryDate, setDeliveryDate] = useState<string>("");
  const [status, setStatus] = useState<OrderStatus>("preparing");

  const showPrices = isEditMode || status === "delivered";
  const [notes, setNotes] = useState<string>("");

  const [items, setItems] = useState<NewOrderItemInput[]>([
    {
      productId: firstProduct?.id ?? "",
      quantity: 1,
      unit: firstProduct?.unit ?? "kg",
      unitPrice: firstProduct?.price ?? 0,
    },
  ]);

  // Raw string values for decimal inputs so users can type "1." or "1," without it vanishing
  const [rawValues, setRawValues] = useState<Record<string, string>>({});

  const getRaw = (index: number, field: "quantity" | "unitPrice"): string => {
    const key = `${index}-${field}`;
    if (key in rawValues) return rawValues[key];
    return String(items[index]?.[field] ?? "");
  };

  const setRaw = (index: number, field: "quantity" | "unitPrice", val: string) => {
    setRawValues((prev) => ({ ...prev, [`${index}-${field}`]: val }));
  };

  // Phone-based customer lookup
  const customerByPhone = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) {
      if (c.phone) {
        map.set(normalizePhone(c.phone), c);
      }
    }
    return map;
  }, [customers]);

  const matchedCustomer = useMemo(() => {
    if (!phoneLookup.trim()) return null;
    const norm = normalizePhone(phoneLookup);
    if (norm.length < 3) return null;
    // Exact match first
    const exact = customerByPhone.get(norm);
    if (exact) return exact;
    // Partial match (phone ends with the typed digits)
    for (const [phone, customer] of customerByPhone) {
      if (phone.includes(norm) || norm.includes(phone)) return customer;
    }
    return null;
  }, [phoneLookup, customerByPhone]);

  const handlePhoneChange = useCallback(
    (val: string) => {
      setPhoneLookup(val);
      const norm = normalizePhone(val);
      if (norm.length >= 6) {
        for (const [phone, customer] of customerByPhone) {
          if (phone.includes(norm) || norm.includes(phone)) {
            setCustomerId(customer.id);
            return;
          }
        }
      }
    },
    [customerByPhone]
  );

  // Quando entramos em modo edição, preenche com a encomenda; em modo criação, volta aos defaults
  useEffect(() => {
    if (isEditMode && initialOrder) {
      setCustomerId(initialOrder.customerId);
      setDate(initialOrder.date);
      setDeliveryDate(initialOrder.deliveryDate ?? "");
      setStatus(initialOrder.status as OrderStatus);
      setNotes(initialOrder.notes ?? "");
      setPhoneLookup("");
      const newItems = initialOrder.items.map((it) => {
        const p = products.find((pp) => pp.id === it.productId);
        return {
          productId: it.productId,
          quantity: it.quantity,
          unit: it.unit ?? p?.unit ?? "kg",
          unitPrice: it.unitPrice,
        };
      });
      setItems(newItems);
      setRawValues({});
    } else if (!isEditMode) {
      const first = products[0];
      setCustomerId(customers[0]?.id ?? "");
      setDate(todayISO());
      setDeliveryDate("");
      setStatus("preparing");
      setNotes("");
      setPhoneLookup("");
      setItems([
        {
          productId: first?.id ?? "",
          quantity: 1,
          unit: first?.unit ?? "kg",
          unitPrice: first?.price ?? 0,
        },
      ]);
      setRawValues({});
    }
  }, [isEditMode, initialOrder, customers, products]);

  useEffect(() => {
    if (isEditMode) return;

    if (status === "delivered") {
      setItems((prev) =>
        prev.map((it) => {
          const p = products.find((pp) => pp.id === it.productId);
          const base = p?.price ?? 0;
          return {
            ...it,
            unitPrice: it.unitPrice && it.unitPrice > 0 ? it.unitPrice : base,
          };
        })
      );
    } else {
      setItems((prev) => prev.map((it) => ({ ...it, unitPrice: 0 })));
    }
    setRawValues({});
  }, [status, isEditMode, products]);


  const handleAddItem = () => {
    const defaultProduct = products[0];
    setItems((prev) => [
      ...prev,
      {
        productId: defaultProduct?.id ?? "",
        quantity: 1,
        unit: defaultProduct?.unit ?? "kg",
        unitPrice: defaultProduct?.price ?? 0,
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    // Clean up raw values and re-index
    setRawValues((prev) => {
      const next: Record<string, string> = {};
      let newIdx = 0;
      for (let i = 0; i < items.length; i++) {
        if (i === index) continue;
        for (const f of ["quantity", "unitPrice"] as const) {
          const oldKey = `${i}-${f}`;
          if (oldKey in prev) next[`${newIdx}-${f}`] = prev[oldKey];
        }
        newIdx++;
      }
      return next;
    });
  };

  const handleItemChange = (
    index: number,
    field: keyof NewOrderItemInput,
    value: string | number
  ) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;

        if (field === "productId") {
          const product = products.find((p) => p.id === value);
          return {
            ...item,
            productId: value as string,
            unit: product?.unit ?? item.unit ?? "kg",
            unitPrice: showPrices ? (product ? product.price : item.unitPrice) : 0,
          };
        }

        if (field === "quantity" || field === "unitPrice") {
          const raw = String(value);
          setRaw(index, field, raw);
          return {
            ...item,
            [field]: parseDecimal(raw),
          } as NewOrderItemInput;
        }

        return { ...item, [field]: value } as NewOrderItemInput;
      })
    );
  };

  const orderTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [items]
  );

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();

    if (!customerId) return;
    if (!items.length) return;

    const cleanedItems = items.filter((it) => it.productId && it.quantity > 0);

    const payload: NewOrderInput = {
      customerId,
      date,
      deliveryDate: deliveryDate || undefined,
      status,
      notes: notes.trim() || undefined,
      items: cleanedItems,
    };

    if (isEditMode && initialOrder && onUpdate) {
      await onUpdate(initialOrder.id, payload);
    } else if (!isEditMode && onCreate) {
      await onCreate(payload);
    }
  };

  return (
    <form className="card order-form" onSubmit={handleSubmit}>

      <h2 className="card-title">
        {isEditMode ? "Editar encomenda" : "Nova encomenda"}
      </h2>
      <p className="page-subtitle">
        {isEditMode
          ? "Atualiza os dados da encomenda deste cliente."
          : "Escolhe o cliente, datas e produtos para registar uma nova encomenda."}
      </p>

      <div className="page-grid">
        {/* Coluna esquerda: dados gerais */}
        <div>
          <div className="field">
            <label>Telemóvel do cliente</label>
            <input
              type="tel"
              inputMode="tel"
              value={phoneLookup}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="Digita o nº para encontrar o cliente..."
              aria-describedby="phone-match-hint"
            />
            {phoneLookup.trim().length >= 3 && (
              <span
                id="phone-match-hint"
                className={`phone-match-hint ${matchedCustomer ? "matched" : "no-match"}`}
              >
                {matchedCustomer
                  ? `✓ ${matchedCustomer.name}`
                  : "Nenhum cliente encontrado"}
              </span>
            )}
          </div>

          <div className="field">
            <label>Cliente</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Data da encomenda</label>
            <DatePicker value={date} onChange={setDate} required />
          </div>

          <div className="field">
            <label>Data de entrega</label>
            <DatePicker value={deliveryDate} onChange={setDeliveryDate} />
          </div>

          <div className="field">
            <label>Estado</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus)}
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Notas internas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: Entregar sempre depois das 18h, cliente prefere sacos pequenos..."
            />
          </div>
        </div>

        {/* Coluna direita: produtos */}
        <div className="order-items-block">
          <div className="order-items-header">
            <h3>Produtos</h3>
          </div>

          <div className="table-wrapper">
            <table className="simple-table">
              <thead>
                <tr>
                  <th style={{ width: "50%" }}>Produto</th>
                  <th style={{ width: "30%" }}>Quantidade & Unidade</th>
                  {showPrices && <th style={{ width: "12%" }}>Preço / un.</th>}
                  {showPrices && <th style={{ width: "12%" }}>Subtotal</th>}
                  <th style={{ width: "6%" }} />
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const product = products.find(
                    (p) => p.id === item.productId
                  );
                  const lineTotal = item.quantity * item.unitPrice;

                  return (
                    <tr key={index}>
                      <td>
                        <select
                          value={item.productId}
                          onChange={(e) =>
                            handleItemChange(
                              index,
                              "productId",
                              e.target.value
                            )
                          }
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="quantity-and-unit-cell">
                          <div className="quantity-section">
                            <label className="qty-label">Quantidade</label>
                            <div className="quantity-input-group">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={getRaw(index, "quantity")}
                                onChange={(e) =>
                                  handleItemChange(
                                    index,
                                    "quantity",
                                    e.target.value
                                  )
                                }
                                aria-label={`Quantidade de ${product?.name ?? "produto"}`}
                              />
                              <div className="quantity-shortcuts">
                                <button
                                  type="button"
                                  className="qty-shortcut-btn"
                                  onClick={() =>
                                    handleItemChange(index, "quantity", "0.5")
                                  }
                                  title="Definir quantidade para 0.5"
                                >
                                  0.5
                                </button>
                                <button
                                  type="button"
                                  className="qty-shortcut-btn"
                                  onClick={() =>
                                    handleItemChange(index, "quantity", "1")
                                  }
                                  title="Definir quantidade para 1"
                                >
                                  1
                                </button>
                                <button
                                  type="button"
                                  className="qty-shortcut-btn"
                                  onClick={() =>
                                    handleItemChange(index, "quantity", "2")
                                  }
                                  title="Definir quantidade para 2"
                                >
                                  2
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="unit-section">
                            <label className="unit-label">Unidade</label>
                            <div className="unit-selector">
                              {(["kg", "un", "molho"] as const).map((unit) => (
                                <button
                                  key={unit}
                                  type="button"
                                  className={`unit-btn ${
                                    (item.unit ?? product?.unit ?? "kg") === unit
                                      ? "active"
                                      : ""
                                  }`}
                                  onClick={() =>
                                    handleItemChange(index, "unit", unit)
                                  }
                                  title={`Unidade: ${
                                    unit === "kg"
                                      ? "Quilogramas"
                                      : unit === "un"
                                        ? "Unidades"
                                        : "Molhos"
                                  }`}
                                >
                                  {unit === "kg"
                                    ? "kg"
                                    : unit === "un"
                                      ? "uni"
                                      : "molho"}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                      {showPrices && (
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={getRaw(index, "unitPrice")}
                            onChange={(e) =>
                              handleItemChange(
                                index,
                                "unitPrice",
                                e.target.value
                              )
                            }
                            aria-label={`Preço de ${product?.name ?? "produto"}`}
                          />
                        </td>
                      )}
                      {showPrices && (
                        <td>
                          {lineTotal.toLocaleString("pt-PT", {
                            style: "currency",
                            currency: "EUR",
                          })}
                        </td>
                      )}
                      <td>
                        {items.length > 1 && (
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => handleRemoveItem(index)}
                            aria-label="Remover linha"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={showPrices ? 2 : 2}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleAddItem}
                    >
                      + Adicionar produto
                    </button>
                  </td>

                  {showPrices && (
                    <td colSpan={2} style={{ textAlign: "right" }}>
                      <strong>Total da encomenda: </strong>
                      {orderTotal.toLocaleString("pt-PT", {
                        style: "currency",
                        currency: "EUR",
                      })}
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <div className="form-actions">
        {isEditMode && onCancelEdit && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancelEdit}
          >
            Cancelar edição
          </button>
        )}
        <button type="submit" className="btn-primary">
          {isEditMode ? "Guardar alterações" : "Guardar encomenda"}
        </button>
      </div>
    </form>
  );
};

export default OrderForm;
