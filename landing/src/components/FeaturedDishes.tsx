import React from 'react';

interface DishItem {
  number: string;
  name: string;
  subtitle: string;
  notes: string;
  ingredients: string[];
  price: string;
  image: string;
  imageAlt: string;
}

const DISHES: DishItem[] = [
  {
    number: '01',
    name: 'La Doble Madurada',
    subtitle: 'Grasa noble noisette · Queso cuartirolo ahumado · Pan brioche de grasa',
    notes: '80 días de maduración en cámara seca. El corte adquiere notas a frutos secos y corteza intensa.',
    ingredients: ['Carne vacuna de pastura', 'Grasa dry-aged', 'Sal de roca marina', 'Pimienta negra silvestre'],
    price: '$12.800',
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1000&q=80',
    imageAlt: 'Hamburguesa de autor con queso fundido y pan tostado'
  },
  {
    number: '02',
    name: 'Tartar de Lomo & Yema en Ceniza',
    subtitle: 'Corte a cuchillo en el momento · Alcaparras fritas · Mostaza antigua',
    notes: 'Temperatura de servicio: 12°C. Acompañado de tostadas finas de masa madre de 72 horas.',
    ingredients: ['Lomo vacuno seleccionado', 'Yema de campo curada en salmuera', 'Aceite de oliva virgen extra'],
    price: '$14.200',
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1000&q=80',
    imageAlt: 'Corte gastronómico de carne al fuego'
  },
  {
    number: '03',
    name: 'Costillar a la Brasa de Quebracho',
    subtitle: '14 horas de cocción lenta · Laqueado de ciruela silvestre & vermut',
    notes: 'Hueso limpio que se desprende sin esfuerzo. El humo de madera dura sella la superficie.',
    ingredients: ['Costilla vacuna de pastura', 'Humo de quebracho blanco', 'Reducción de frutos negros'],
    price: '$21.500',
    image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1000&q=80',
    imageAlt: 'Servicio en restaurante de autor'
  }
];

export const FeaturedDishes: React.FC = () => {
  return (
    <section id="platos" className="py-24 sm:py-36 bg-dark-surface border-b border-dark-border">
      <div className="max-w-7xl mx-auto px-6 sm:px-10">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16 sm:mb-24">
          <div>
            <div className="font-ancha text-[10px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-3 font-bold">
              [ 03 // LA COLECCIÓN DE AUTOR ]
            </div>
            <h2 className="font-serif font-normal text-tinta text-3xl sm:text-5xl font-bold tracking-tight">
              Platos que no admiten prisa.
            </h2>
          </div>
          <p className="font-ancha text-xs text-bone-muted max-w-xs">
            Cada plato cuenta con control de stock instantáneo en la tablet de cocina y atención automática en WhatsApp.
          </p>
        </div>

        {/* Asymmetric Alternating Dishes Layouts */}
        <div className="space-y-20 sm:space-y-32">
          {DISHES.map((dish, idx) => {
            const isEven = idx % 2 === 0;
            return (
              <div 
                key={dish.number}
                className={`grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center ${
                  isEven ? '' : 'lg:flex-row-reverse'
                }`}
              >
                
                {/* Photo Column (6 cols) */}
                <div className={`lg:col-span-6 relative ${isEven ? '' : 'lg:order-2'}`}>
                  <div className="overflow-hidden bg-dark-card border border-dark-border shadow-sm rounded-sm group">
                    <img 
                      src={dish.image} 
                      alt={dish.imageAlt}
                      className="w-full h-[360px] sm:h-[440px] object-cover filter saturate-[0.9] contrast-[1.08] group-hover:scale-105 transition-transform duration-1000"
                      loading="lazy"
                    />
                    <div className="p-3.5 bg-paper-pure text-tinta border-t border-paper-border flex justify-between items-center font-ancha text-[10px]">
                      <span className="font-bold text-tinta">CÓDIGO DE RECETA // {dish.number}</span>
                      <span className="text-terracota font-bold text-xs">{dish.price}</span>
                    </div>
                  </div>
                </div>

                {/* Information Column (6 cols) */}
                <div className={`lg:col-span-6 space-y-6 ${isEven ? '' : 'lg:order-1'}`}>
                  <div className="flex items-center gap-3 font-ancha text-xs text-bone-muted">
                    <span className="text-terracota font-bold">{dish.number}</span>
                    <span>/</span>
                    <span className="uppercase tracking-wider text-tinta font-semibold">CARTA NOCTURNA</span>
                  </div>

                  <h3 className="font-serif font-bold text-2xl sm:text-4xl text-tinta leading-tight">
                    {dish.name}
                  </h3>

                  <p className="font-sans text-sm sm:text-base text-bone-muted leading-relaxed font-normal">
                    {dish.subtitle}
                  </p>

                  <p className="font-serif text-xs sm:text-sm text-tinta/80 border-l-2 border-terracota pl-4">
                    "{dish.notes}"
                  </p>

                  <div className="pt-2">
                    <span className="font-ancha text-[10px] uppercase tracking-wider text-bone-muted block mb-2 font-semibold">
                      Materia Prima & Origen:
                    </span>
                    <div className="flex flex-wrap gap-2 font-ancha text-[11px] text-tinta">
                      {dish.ingredients.map((ing, i) => (
                        <span key={i} className="px-2.5 py-1 bg-dark-card border border-dark-border rounded-sm">
                          {ing}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
