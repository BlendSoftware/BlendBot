import { useState } from 'react';
import { GrainOverlay } from './components/GrainOverlay';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { KitchenManifesto } from './components/KitchenManifesto';
import { EditorialPillars } from './components/EditorialPillars';
import { FeaturedDishes } from './components/FeaturedDishes';
import { AtmosphereGallery } from './components/AtmosphereGallery';
import { MembershipSection } from './components/MembershipSection';
import { FaqSection } from './components/FaqSection';
import { MonumentalFooter } from './components/MonumentalFooter';
import { DemoModal } from './components/DemoModal';

export function App() {
  const [isDemoModalOpen, setIsDemoModalOpen] = useState<boolean>(false);

  const handleOpenDemo = () => {
    setIsDemoModalOpen(true);
  };

  const handleCloseDemo = () => {
    setIsDemoModalOpen(false);
  };

  const handleScrollToRituals = () => {
    const el = document.getElementById('rituales');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="relative min-h-screen bg-dark text-bone selection:bg-gold selection:text-dark font-sans">
      {/* Subtle dark film grain overlay */}
      <GrainOverlay />

      {/* Clean Minimalist Masthead */}
      <Header onOpenDemo={handleOpenDemo} />

      <main>
        {/* 01: Hero Magazine Cover */}
        <Hero 
          onOpenSimulator={handleScrollToRituals}
          onOpenDemo={handleOpenDemo}
        />

        {/* 02: Kitchen Reality Manifesto */}
        <KitchenManifesto />

        {/* 03: The 3 Hospitality & Kitchen Rituals */}
        <EditorialPillars />

        {/* 04: Author Dishes Collection */}
        <FeaturedDishes />

        {/* 05: 35mm Atmosphere Photo Essay */}
        <AtmosphereGallery />

        {/* 06: Honest Atelier Membership ($79.000 ARS, 0% commissions) */}
        <MembershipSection onOpenDemo={handleOpenDemo} />

        {/* 07: Counter FAQs */}
        <FaqSection />
      </main>

      {/* 08: Monumental Colophon & Footer */}
      <MonumentalFooter onOpenDemo={handleOpenDemo} />

      {/* Bespoke Lead Modal */}
      <DemoModal 
        isOpen={isDemoModalOpen} 
        onClose={handleCloseDemo} 
      />
    </div>
  );
}

export default App;
