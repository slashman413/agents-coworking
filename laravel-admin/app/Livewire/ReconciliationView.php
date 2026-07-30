<?php

namespace App\Livewire;

use Livewire\Component;

class ReconciliationView extends Component
{
    public $morRecords = [];
    public $localRecords = [];
    public $discrepancies = [];

    public function mount()
    {
        // Mock data for reconciliation
        $this->morRecords = [
            ['id' => 'tx_1', 'amount' => 199.00, 'product' => "Founder's FP&A Master Toolkit", 'status' => 'paid'],
            ['id' => 'tx_2', 'amount' => 299.00, 'product' => "Product #2: SaaS Cohort Retention Model", 'status' => 'paid'],
        ];

        $this->localRecords = [
            ['id' => 'tx_1', 'amount' => 199.00, 'product' => "Founder's FP&A Master Toolkit", 'status' => 'paid'],
            // tx_2 is missing locally to show a discrepancy
        ];

        $this->calculateDiscrepancies();
    }

    public function calculateDiscrepancies()
    {
        $localIds = array_column($this->localRecords, 'id');
        $this->discrepancies = array_filter($this->morRecords, function($morRecord) use ($localIds) {
            return !in_array($morRecord['id'], $localIds);
        });
    }

    public function syncRecord($id)
    {
        // Logic to sync record from MoR to local DB
        session()->flash('message', "Record {$id} successfully synchronized.");
    }

    public function render()
    {
        return view('livewire.reconciliation-view');
    }
}
