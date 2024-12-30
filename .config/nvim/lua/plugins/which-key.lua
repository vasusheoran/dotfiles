return {
    'folke/which-key.nvim',
    opts = {},
    config = function()
        require('which-key').register {

            ['<C-p>'] = { name = 'Find File', _ = 'which_key_ignore' },
            ['<leader><space>'] = { name = 'Search Old Files', _ = 'which_key_ignore' },
            ['<leader>b'] = { name = '[B]uffers', _ = 'which_key_ignore' },
            ['<leader>f'] = { name = '[F]ind', _ = 'which_key_ignore' },
        }
    end
}
