<div>
    <flux:card class="luxury-glass p-8 hover:scale-[1.01] transition-all duration-300">
        <div class="flex justify-between items-center mb-6">
            <flux:heading size="xl" class="gradient-text font-bold tracking-tight">MoR Reconciliation Dashboard</flux:heading>
            <flux:badge color="amber" class="magnetic-element">{{ count($discrepancies) }} Discrepancies Found</flux:badge>
        </div>

        @if (session()->has('message'))
            <flux:alert color="success" class="mb-4 animate-pulse">
                {{ session('message') }}
            </flux:alert>
        @endif

        <div class="space-y-6">
            <flux:heading size="lg" class="text-white opacity-90">Unsynced Transactions</flux:heading>
            
            <div class="grid gap-4">
                @forelse ($discrepancies as $record)
                    <flux:card class="bg-white/5 border border-white/10 p-4 rounded-xl flex justify-between items-center magnetic-element">
                        <div>
                            <flux:text class="text-sm text-gray-400">Transaction ID: {{ $record['id'] }}</flux:text>
                            <flux:heading size="md" class="text-white mt-1">{{ $record['product'] }}</flux:heading>
                            <flux:text class="text-emerald-400 font-semibold mt-2">${{ number_format($record['amount'], 2) }}</flux:text>
                        </div>
                        <flux:button 
                            wire:click="syncRecord('{{ $record['id'] }}')" 
                            color="primary" 
                            class="luxury-btn"
                        >
                            Sync to Local DB
                        </flux:button>
                    </flux:card>
                @empty
                    <flux:card class="bg-white/5 border border-white/10 p-8 rounded-xl text-center">
                        <flux:icon name="check-circle" class="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                        <flux:heading size="md" class="text-white">All Records Synchronized</flux:heading>
                        <flux:text class="text-gray-400 mt-2">MoR and local database are in perfect harmony.</flux:text>
                    </flux:card>
                @endforelse
            </div>
        </div>
    </flux:card>

    <style>
        .luxury-glass {
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(40px) saturate(200%);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 24px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }
        .gradient-text {
            background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .magnetic-element {
            transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), background 0.3s ease;
        }
        .magnetic-element:hover {
            transform: scale(1.02) translateY(-2px);
            background: rgba(255, 255, 255, 0.08);
        }
        .luxury-btn {
            background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.3);
            transition: all 0.3s ease;
        }
        .luxury-btn:hover {
            box-shadow: 0 15px 25px -5px rgba(79, 70, 229, 0.5);
            transform: translateY(-1px);
        }
    </style>
</div>
