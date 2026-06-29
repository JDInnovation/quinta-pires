import React, { useMemo, useState } from "react";
import type { Order } from "../../types";
import OrderForm, { type NewOrderInput } from "./OrderForm";
import OrderList from "./OrderList";
import { useCustomers } from "../../context/CustomersContext";
import { useProducts } from "../../context/ProductsContext";
import { useOrders } from "../../context/OrdersContext";
import { LoadingCard } from "../../components/LoadingCard";
import { useConfirm } from "../../components/ConfirmProvider";
import toast from "react-hot-toast";

const OrdersPage: React.FC = () => {
  const confirm = useConfirm();
  const { customers } = useCustomers();
  const { products, loadingProducts } = useProducts();
  const {
    orders,
    loadingOrders,
    createOrder,
    updateOrder,
    updateOrderStatus,
    deleteOrder,
  } = useOrders();

  const [showForm, setShowForm] = useState<boolean>(true);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const handleCreateOrder = async (data: NewOrderInput) => {
    const payload: Omit<Order, "id"> = {
      customerId: data.customerId,
      date: data.date,
      deliveryDate: data.deliveryDate || undefined,
      status: data.status,
      notes: data.notes?.trim() || undefined,
      items: data.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
      })),
    };

    try {
      await createOrder(payload);
      setShowForm(false);
    } catch {
      toast.error("Não foi possível criar a encomenda.");
    }
  };

  const handleUpdateOrder = async (orderId: string, data: NewOrderInput) => {
    const payload: Omit<Order, "id"> = {
      customerId: data.customerId,
      date: data.date,
      deliveryDate: data.deliveryDate || undefined,
      status: data.status,
      notes: data.notes?.trim() || undefined,
      items: data.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
      })),
    };

    try {
      await updateOrder(orderId, payload);
      setEditingOrder(null);
    } catch {
      toast.error("Não foi possível guardar alterações.");
    }
  };

  const handleChangeStatus = async (orderId: string, status: Order["status"]) => {
    try {
      await updateOrderStatus(orderId, status);
    } catch {
      toast.error("Não foi possível atualizar o estado.");
    }
  };

  const handleDelete = async (orderId: string) => {
    const confirmed = await confirm({
      title: "Apagar encomenda",
      message: "Tens a certeza que queres apagar esta encomenda?",
      confirmLabel: "Apagar",
      tone: "danger",
    });
    if (!confirmed) return;

    try {
      await deleteOrder(orderId);
    } catch {
      toast.error("Não foi possível apagar a encomenda.");
    }
  };

  const handleBulkDelete = async (orderIds: string[]) => {
    try {
      await Promise.all(orderIds.map((id) => deleteOrder(id)));
      toast.success(`${orderIds.length} encomenda(s) apagadas.`);
    } catch {
      toast.error("Não foi possível apagar todas as encomendas.");
    }
  };

  const handleBulkChangeStatus = async (orderIds: string[], status: Order["status"]) => {
    try {
      await Promise.all(orderIds.map((id) => updateOrderStatus(id, status)));
      toast.success(`Estado de ${orderIds.length} encomenda(s) atualizado.`);
    } catch {
      toast.error("Não foi possível atualizar o estado de todas as encomendas.");
    }
  };

  const handleEditRequest = (order: Order) => {
    setEditingOrder(order);
    setShowForm(false);
  };

  const handleCancelEdit = () => {
    setEditingOrder(null);
  };

  const totalRevenue = useMemo(
    () =>
      orders.reduce((acc, order) => {
        const orderTotal = order.items.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice,
          0
        );
        return acc + orderTotal;
      }, 0),
    [orders]
  );

  const preparingCount = useMemo(
    () => orders.filter((o) => o.status === "preparing").length,
    [orders]
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Encomendas</h1>
          <p className="page-subtitle">
            Regista, edita e acompanha as encomendas dos teus clientes.
          </p>
        </div>

        <div className="dashboard-header-right">
          <div className="chip">
            Total registado:{" "}
            <strong>
              {totalRevenue.toLocaleString("pt-PT", {
                style: "currency",
                currency: "EUR",
              })}
            </strong>
          </div>
          <div className="chip">
            Em preparação: <strong>{preparingCount}</strong>
          </div>

          <button
            type="button"
            className="btn-secondary"
            disabled={!!editingOrder}
            onClick={() => setShowForm((v) => !v)}
          >
            {editingOrder
              ? "A editar encomenda"
              : showForm
              ? "Fechar formulário"
              : "Nova encomenda"}
          </button>
        </div>
      </header>

      <div className="page-grid-vertical">
        {editingOrder ? (
          <OrderForm
            mode="edit"
            initialOrder={editingOrder}
            customers={customers}
            products={products}
            onUpdate={handleUpdateOrder}
            onCancelEdit={handleCancelEdit}
          />
        ) : (
          showForm &&
          customers.length > 0 &&
          !loadingProducts &&
          products.length > 0 && (
            <OrderForm
              mode="create"
              customers={customers}
              products={products}
              onCreate={handleCreateOrder}
            />
          )
        )}

        {showForm && !editingOrder && loadingProducts && (
          <LoadingCard message="A carregar produtos..." />
        )}

        {loadingOrders ? (
          <LoadingCard message="A carregar encomendas..." />
        ) : (
          <OrderList
            orders={orders}
            customers={customers}
            products={products}
            onChangeStatus={handleChangeStatus}
            onDelete={handleDelete}
            onEdit={handleEditRequest}
            onBulkDelete={handleBulkDelete}
            onBulkChangeStatus={handleBulkChangeStatus}
          />
        )}
      </div>
    </div>
  );
};

export default OrdersPage;
