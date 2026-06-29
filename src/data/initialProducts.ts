import type { Product } from "../types";

/** Produtos base para seed inicial no Firestore. */
export const initialProducts: Product[] = [
  // 🥕 Hortícolas
  { id: "brocolos", name: "Brócolos", unit: "kg", price: 3 },
  { id: "brocolos-roxos", name: "Brócolos Roxos", unit: "kg", price: 5 },
  { id: "caldo-verde-cortado", name: "Caldo Verde Cortado", unit: "kg", price: 2.5 },
  { id: "couve-penca", name: "Couve Penca / Tronchuda / Portuguesa", unit: "un", price: 1.5 },
  { id: "couve-coracao", name: "Couve Coração", unit: "kg", price: 1.5 },
  { id: "couve-flor", name: "Couve-flor", unit: "kg", price: 2.5 },
  { id: "couve-roxa", name: "Couve Roxa", unit: "kg", price: 1.5 },
  { id: "couve-lombarda", name: "Couve Lombarda", unit: "kg", price: 1.5 },
  { id: "couve-kale", name: "Couve Kale (roxa ou verde)", unit: "molho", price: 0.8 },
  { id: "grelos", name: "Grelos", unit: "molho", price: 3 },
  { id: "nabicas", name: "Nabiças", unit: "molho", price: 2 },
  { id: "alface", name: "Alface", unit: "un", price: 0.8 },
  { id: "rabano", name: "Rábano (roxo ou verde)", unit: "un", price: 0.8 },
  { id: "pimento-vermelho", name: "Pimento vermelho", unit: "kg", price: 3.5 },
  { id: "alho-frances", name: "Alho-francês", unit: "un", price: 0.8 },
  { id: "nabos", name: "Nabos", unit: "kg", price: 2.5 },
  { id: "pepino", name: "Pepino", unit: "kg", price: 2.5 },
  { id: "beterraba", name: "Beterraba", unit: "kg", price: 2.5 },
  { id: "abobora-manteiga", name: "Abóbora Manteiga", unit: "kg", price: 1.5 },
  { id: "abobora-menina-inteira", name: "Abóbora Menina inteira", unit: "kg", price: 0.8 },
  { id: "abobora-menina-cubos", name: "Abóbora Menina em cubos", unit: "kg", price: 1.5 },
  { id: "noz", name: "Noz", unit: "kg", price: 4 },
  { id: "espinafre", name: "Espinafre", unit: "un", price: 1 },

  // 🥔 Batatas
  { id: "batata-vermelha", name: "Batata Vermelha", unit: "kg", price: 0.7 },
  { id: "sacos-batata-vermelha", name: "Sacos 10kg / 20kg (Batata Vermelha)", unit: "kg", price: 0.6 },
  { id: "batata-assar", name: "Batata para assar", unit: "kg", price: 1.2 },
  { id: "batata-agria", name: "Batata Agria", unit: "kg", price: 0.8 },
  { id: "sacos-batata-agria", name: "Sacos 10kg / 20kg (Batata Agria)", unit: "kg", price: 0.7 },
  { id: "batata-doce-roxa", name: "Batata-doce Roxa", unit: "kg", price: 1.2 },
  { id: "batata-doce-laranja", name: "Batata-doce Laranja", unit: "kg", price: 1.5 },

  // 🍎 Fruta
  { id: "kiwi", name: "Kiwi", unit: "kg", price: 2.5 },
  { id: "kiwi-pequeno", name: "Kiwi pequeno", unit: "kg", price: 1.6 },
  { id: "limao", name: "Limão", unit: "kg", price: 1.5 },
  { id: "lima", name: "Lima", unit: "kg", price: 1.5 },
  { id: "tangerina", name: "Tangerina", unit: "kg", price: 2.5 },
  { id: "roma", name: "Romã", unit: "kg", price: 2.5 },
  { id: "diospiro-roer", name: "Dióspiro de roer", unit: "kg", price: 2.5 },
  { id: "abacate", name: "Abacate", unit: "kg", price: 3.8 },
  { id: "kiwano", name: "Kiwano", unit: "kg", price: 2 },
  { id: "ameixa-vermelha", name: "Ameixa vermelha", unit: "kg", price: 2.5 },
  { id: "abacaxi", name: "Abacaxi", unit: "kg", price: 2.99 },
  { id: "melao", name: "Melão", unit: "kg", price: 2.75 },
  { id: "pera", name: "Pera", unit: "kg", price: 2.6 },
  { id: "castanha", name: "Castanha", unit: "kg", price: 5.5 },

  // 🌿 Aromáticas
  { id: "salsa", name: "Salsa", unit: "un", price: 0.8 },
  { id: "coentros", name: "Coentros", unit: "un", price: 0.8 },
  { id: "aipo", name: "Aipo", unit: "un", price: 0.8 },

  // 🤝 Parceiros Locais
  { id: "cenoura-rama", name: "Cenoura de rama (Vagueira)", unit: "kg", price: 1.6 },
  { id: "tomate-salada", name: "Tomate salada (Vagos)", unit: "kg", price: 2.8 },
  { id: "tomate-cherry", name: "Tomate cherry (Vagos)", unit: "kg", price: 3.5 },
  { id: "cebola-vagueira", name: "Cebola (Vagueira)", unit: "kg", price: 2 },
  { id: "cebola-roxa", name: "Cebola Roxa", unit: "kg", price: 2 },
  { id: "alho-seco", name: "Alho Seco", unit: "kg", price: 5.5 },
  { id: "laranja-algarve", name: "Laranja do Algarve", unit: "kg", price: 1.8 },
  { id: "maca-golden", name: "Maçã Golden (Lamego)", unit: "kg", price: 1.5 },
  { id: "maca-fuji", name: "Maçã Fuji (Lamego)", unit: "kg", price: 1.75 },

  // ❄️ Fruta Congelada (produção própria 2025)
  { id: "mirtilos-congelados", name: "Mirtilos (congelados)", unit: "kg", price: 5 },
  { id: "framboesa-congelada", name: "Framboesa (congelada)", unit: "kg", price: 5 },
];
