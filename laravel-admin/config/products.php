<?php

return [
    'products' => [
        'fp_a_master_toolkit' => [
            'id' => 'prod_001',
            'name' => "Founder's FP&A Master Toolkit",
            'price' => 199.00,
            'currency' => 'USD',
            'active' => true,
        ],
        'saas_cohort_retention_model' => [
            'id' => 'prod_002',
            'name' => 'Product #2: SaaS Cohort Retention Model',
            'price' => 299.00,
            'currency' => 'USD',
            'active' => true,
            'features' => [
                'Automated MRR tracking',
                'Cohort analysis dashboard',
                'Churn prediction metrics',
            ],
            'theme' => 'dark-glass',
        ],
    ],
];
