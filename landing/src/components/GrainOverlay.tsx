import React from 'react';

export const GrainOverlay: React.FC = () => {
  return (
    <div 
      className="pointer-events-none fixed inset-0 z-50 h-full w-full opacity-[0.035] mix-blend-overlay bg-grain"
      aria-hidden="true"
    />
  );
};
