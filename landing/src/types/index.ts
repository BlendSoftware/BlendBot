export interface ChatMessage {
  id: string;
  sender: 'client' | 'bot';
  time: string;
  text: string;
  isAudio?: boolean;
  audioDuration?: string;
  meta?: {
    dishName?: string;
    price?: number;
    options?: string[];
  };
}

export interface KitchenOrderItem {
  name: string;
  quantity: number;
  price: number;
  notes?: string;
  status: 'pending' | 'cooking' | 'ready';
}

export interface KitchenOrder {
  id: string;
  tableOrChannel: string;
  clientName: string;
  time: string;
  items: KitchenOrderItem[];
  total: number;
  status: 'pendiente' | 'en-marcha' | 'listo' | 'cobrado';
  isOutOfStockAlert?: boolean;
  outOfStockDish?: string;
}

export interface FiscalInvoice {
  cae: string;
  caeVto: string;
  ptoVta: string;
  cbteNro: string;
  fecha: string;
  cuitEmisor: string;
  razonSocial: string;
  importeTotal: number;
  ivaTotal: number;
  qrData: string;
}

export interface PillarData {
  number: string;
  tag: string;
  title: string;
  subtitle: string;
  description: string;
  bulletPoints: string[];
  quote: string;
  quoteAuthor: string;
  visualType: 'whatsapp' | 'tablet' | 'arca';
  stats: {
    label: string;
    value: string;
  };
}

export interface ComparisonItem {
  feature: string;
  category: string;
  blendbot: {
    status: boolean;
    text: string;
    highlight?: boolean;
  };
  pedidosYa: {
    status: boolean;
    text: string;
  };
  genericBot: {
    status: boolean;
    text: string;
  };
  manual: {
    status: boolean;
    text: string;
  };
}

export interface FaqItem {
  question: string;
  answer: string;
  category: 'operaciones' | 'arca' | 'precios' | 'whatsapp';
}
